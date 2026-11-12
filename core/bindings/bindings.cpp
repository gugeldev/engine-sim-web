// engine-sim-web WASM bindings.
//
// Replaces the Piranha scripting layer of the original engine-sim: an engine
// is described by a plain JS object (see src/sim/spec.ts) using explicit,
// human-friendly units (mm, cc, deg, rpm, cfm...). This file converts those
// into engine-sim's internal SI units and wires the objects together in the
// same order the original es_script nodes did.

#include "../engine-sim/include/engine.h"
#include "../engine-sim/include/piston_engine_simulator.h"
#include "../engine-sim/include/standard_valvetrain.h"
#include "../engine-sim/include/vtec_valvetrain.h"
#include "../engine-sim/include/direct_throttle_linkage.h"
#include "../engine-sim/include/governor.h"
#include "../engine-sim/include/units.h"
#include "../engine-sim/include/constants.h"
#include "../engine-sim/include/gas_system.h"
#include "../engine-sim/include/impulse_response.h"

#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <string>
#include <vector>

using emscripten::val;

namespace {
    // ---------------------------------------------------------------------
    // Small helpers for reading the spec object
    // ---------------------------------------------------------------------

    bool has(const val &v, const char *key) {
        if (v.isUndefined() || v.isNull()) return false;
        const val f = v[key];
        return !(f.isUndefined() || f.isNull());
    }

    double num(const val &v, const char *key, double fallback) {
        return has(v, key) ? v[key].as<double>() : fallback;
    }

    int integer(const val &v, const char *key, int fallback) {
        return has(v, key) ? v[key].as<int>() : fallback;
    }

    bool boolean(const val &v, const char *key, bool fallback) {
        return has(v, key) ? v[key].as<bool>() : fallback;
    }

    std::string str(const val &v, const char *key, const std::string &fallback) {
        return has(v, key) ? v[key].as<std::string>() : fallback;
    }

    int length(const val &v) {
        if (v.isUndefined() || v.isNull()) return 0;
        return v["length"].as<int>();
    }

    double mm(double v) { return units::distance(v, units::mm); }
    double deg(double v) { return units::angle(v, units::deg); }
    double cc(double v) { return units::volume(v, units::cc); }
    double cm2(double v) { return units::area(v, units::cm2); }

    // Builds a Function from {filterRadius, samples: [[x, y], ...]} applying
    // unit scales to x and y.
    Function *makeFunction(const val &f, double xScale, double yScale, double defaultRadius) {
        Function *function = new Function;
        const val samples = f["samples"];
        const int n = length(samples);
        function->initialize(n, num(f, "filterRadius", defaultRadius) * xScale);
        for (int i = 0; i < n; ++i) {
            const val s = samples[i];
            function->addSample(s[0].as<double>() * xScale, s[1].as<double>() * yScale);
        }
        return function;
    }

    // Port of es_script::GenerateHarmonicCamLobeNode
    Function *makeHarmonicLobe(double durationAt50Thou, double gamma, double lift, int steps) {
        const double angle = durationAt50Thou / 4;
        const double s = std::pow(2 * units::distance(50, units::thou) / lift, 1 / gamma) - 1;
        const double k = std::acos(s) / angle;
        const double extents = constants::pi / k;
        const double step = extents / (steps - 5.0);

        // FunctionNode::setFilterRadius(step) in the original
        Function *function = new Function;
        function->initialize(steps * 2, step);

        for (int i = 0; i < steps; ++i) {
            if (i == 0) {
                function->addSample(0.0, lift);
            }
            else {
                const double x = i * step;
                const double l = (x >= extents)
                    ? 0.0
                    : lift * std::pow(0.5 + 0.5 * std::cos(k * x), gamma);
                function->addSample(x, l);
                function->addSample(-x, l);
            }
        }

        return function;
    }

    Function *makeLobe(const val &lobe) {
        const std::string type = str(lobe, "type", "harmonic");
        if (type == "harmonic") {
            return makeHarmonicLobe(
                deg(num(lobe, "durationAt50ThouDeg", 220)),
                num(lobe, "gamma", 1.0),
                mm(num(lobe, "liftMm", 10.0)),
                integer(lobe, "steps", 100));
        }
        else {
            // Samples: [[cam angle deg, lift mm]]
            return makeFunction(lobe, units::deg, units::mm, 1.0);
        }
    }

    Camshaft *makeCamshaft(const val &cam, Crankshaft *crankshaft) {
        Camshaft *camshaft = new Camshaft;
        const val lobes = cam["lobesDeg"];
        const int lobeCount = length(lobes);

        Camshaft::Parameters params;
        params.lobes = lobeCount;
        params.advance = deg(num(cam, "advanceDeg", 0.0));
        params.baseRadius = mm(num(cam, "baseRadiusMm", 12.7));
        params.crankshaft = crankshaft;
        params.lobeProfile = makeLobe(cam["lobe"]);
        camshaft->initialize(params);

        for (int i = 0; i < lobeCount; ++i) {
            camshaft->setLobeCenterline(i, deg(lobes[i].as<double>()));
        }

        return camshaft;
    }

    // ---------------------------------------------------------------------
    // Simulation instance
    // ---------------------------------------------------------------------

    struct Instance {
        Engine *engine = nullptr;
        Vehicle *vehicle = nullptr;
        Transmission *transmission = nullptr;
        Simulator *simulator = nullptr;

        std::vector<double> gearRatios;
        std::vector<int16_t> audioScratch;
        std::vector<float> audioOut;

        double stepAccumulator = 0.0;
        double audioSampleRate = 44100.0;

        // Control state (mirrors EngineSimApplication::processEngineInput)
        double targetSpeedSetting = 0.0;
        double speedSetting = 0.0;
        double targetClutchPressure = 1.0;
        double clutchPressure = 1.0;
        double dynoSpeed = 0.0;
        bool dynoAutoSweep = false;
    };

    Instance g;

    void buildEngine(const val &spec) {
        Engine *engine = new Engine;

        const val cranks = spec["crankshafts"];
        const val banks = spec["banks"];
        const val intakes = spec["intakes"];
        const val exhausts = spec["exhausts"];

        int cylinderCount = 0;
        for (int b = 0; b < length(banks); ++b) {
            cylinderCount += length(banks[b]["cylinders"]);
        }

        // Throttle
        Throttle *throttle = nullptr;
        const val throttleSpec = spec["throttle"];
        if (str(throttleSpec, "type", "direct") == "governor") {
            Governor::Parameters p;
            p.minSpeed = units::rpm(num(throttleSpec, "minSpeedRpm", 0));
            p.maxSpeed = units::rpm(num(throttleSpec, "maxSpeedRpm", 0));
            p.minVelocity = num(throttleSpec, "minV", -2.0);
            p.maxVelocity = num(throttleSpec, "maxV", 2.0);
            p.k_s = num(throttleSpec, "kS", 1.0);
            p.k_d = num(throttleSpec, "kD", 300.0);
            p.gamma = num(throttleSpec, "gamma", 0.1);
            Governor *governor = new Governor;
            governor->initialize(p);
            throttle = governor;
        }
        else {
            DirectThrottleLinkage::Parameters p;
            p.gamma = num(throttleSpec, "gamma", 1.0);
            DirectThrottleLinkage *linkage = new DirectThrottleLinkage;
            linkage->initialize(p);
            throttle = linkage;
        }

        Engine::Parameters ep;
        ep.name = str(spec, "name", "Engine");
        ep.crankshaftCount = length(cranks);
        ep.cylinderBanks = length(banks);
        ep.cylinderCount = cylinderCount;
        ep.exhaustSystemCount = length(exhausts);
        ep.intakeCount = length(intakes);
        ep.redline = units::rpm(num(spec, "redlineRpm", 6000));
        ep.starterTorque = units::torque(num(spec, "starterTorqueNm", 270), units::Nm);
        ep.starterSpeed = units::rpm(num(spec, "starterSpeedRpm", 200));
        ep.dynoMinSpeed = units::rpm(num(spec, "dynoMinRpm", 1000));
        ep.dynoMaxSpeed = units::rpm(num(spec, "dynoMaxRpm", num(spec, "redlineRpm", 6000)));
        ep.dynoHoldStep = units::rpm(num(spec, "dynoHoldStepRpm", 100));
        ep.throttle = throttle;
        ep.initialSimulationFrequency = num(spec, "simulationFrequency", 10000);
        ep.initialHighFrequencyGain = num(spec, "hfGain", 0.01);
        ep.initialNoise = num(spec, "noise", 1.0);
        ep.initialJitter = num(spec, "jitter", 0.5);
        engine->initialize(ep);

        // Intakes (k_carb flow constants)
        for (int i = 0; i < length(intakes); ++i) {
            const val in = intakes[i];
            Intake::Parameters p;
            p.volume = units::volume(num(in, "plenumVolumeL", 2.0), units::L);
            p.CrossSectionArea = cm2(num(in, "plenumAreaCm2", 100.0));
            p.InputFlowK = GasSystem::k_carb(num(in, "intakeFlowCfm", 500.0));
            p.IdleFlowK = GasSystem::k_carb(num(in, "idleFlowCfm", 0.0));
            p.RunnerFlowRate = GasSystem::k_carb(num(in, "runnerFlowCfm", 200.0));
            p.MolecularAfr = num(in, "molecularAfr", 25.0 / 2.0);
            p.IdleThrottlePlatePosition = num(in, "idleThrottlePlatePosition", 0.975);
            p.RunnerLength = mm(num(in, "runnerLengthMm", 101.6));
            p.VelocityDecay = num(in, "velocityDecay", 0.25);
            engine->getIntake(i)->initialize(p);
        }

        // Exhaust systems
        for (int i = 0; i < length(exhausts); ++i) {
            const val ex = exhausts[i];
            ExhaustSystem::Parameters p;
            p.collectorCrossSectionArea = cm2(num(ex, "collectorAreaCm2", 20.27));
            p.length = mm(num(ex, "lengthMm", 2000.0));
            p.outletFlowRate = GasSystem::k_carb(num(ex, "outletFlowCfm", 1000.0));
            p.primaryTubeLength = mm(num(ex, "primaryTubeLengthMm", 254.0));
            p.primaryFlowRate = GasSystem::k_carb(num(ex, "primaryFlowCfm", 100.0));
            p.audioVolume = num(ex, "audioVolume", 1.0);
            p.velocityDecay = num(ex, "velocityDecay", 1.0);
            ImpulseResponse *ir = new ImpulseResponse;
            ir->initialize(str(ex, "impulseResponse", ""), num(ex, "impulseVolume", 1.0));
            p.impulseResponse = ir;
            engine->getExhaustSystem(i)->initialize(p);
        }

        // Crankshafts
        for (int i = 0; i < length(cranks); ++i) {
            const val c = cranks[i];
            const val journals = c["journalsDeg"];
            Crankshaft::Parameters p;
            p.crankThrow = mm(num(c, "throwMm", 40));
            p.flywheelMass = num(c, "flywheelMassKg", 10);
            p.mass = num(c, "massKg", 20);
            p.frictionTorque = units::torque(num(c, "frictionTorqueNm", 20), units::Nm);
            p.momentOfInertia = num(c, "momentOfInertia", 0.2);
            p.pos_x = mm(num(c, "xMm", 0));
            p.pos_y = mm(num(c, "yMm", 0));
            p.tdc = deg(num(c, "tdcDeg", 90));
            p.rodJournals = length(journals);
            engine->getCrankshaft(i)->initialize(p);
            for (int j = 0; j < p.rodJournals; ++j) {
                engine->getCrankshaft(i)->setRodJournalAngle(j, deg(journals[j].as<double>()));
            }
        }

        // Cylinder banks, pistons, rods, heads
        int base = 0;
        for (int b = 0; b < length(banks); ++b) {
            const val bank = banks[b];
            const val cylinders = bank["cylinders"];
            const int n = length(cylinders);

            CylinderBank::Parameters bp;
            bp.angle = deg(num(bank, "angleDeg", 0));
            bp.bore = mm(num(bank, "boreMm", 80));
            bp.deckHeight = mm(num(bank, "deckHeightMm", 200));
            bp.positionX = mm(num(bank, "xMm", 0));
            bp.positionY = mm(num(bank, "yMm", 0));
            bp.displayDepth = num(bank, "displayDepth", 0.5);
            bp.cylinderCount = n;
            bp.index = b;
            bp.crankshaft = engine->getCrankshaft(0);
            CylinderBank *cylinderBank = engine->getCylinderBank(b);
            cylinderBank->initialize(bp);

            for (int i = 0; i < n; ++i) {
                const val cyl = cylinders[i];
                const val ps = cyl["piston"];
                const val rs = cyl["rod"];
                const val js = cyl["journal"];

                Piston *piston = engine->getPiston(base + i);
                ConnectingRod *rod = engine->getConnectingRod(base + i);

                Piston::Parameters pp;
                pp.Bank = cylinderBank;
                pp.CylinderIndex = i;
                pp.Rod = rod;
                pp.mass = num(ps, "massKg", 0.4);
                pp.BlowbyFlowCoefficient = GasSystem::k_28inH2O(num(ps, "blowbyCfm", 0.0));
                pp.CompressionHeight = mm(num(ps, "compressionHeightMm", 25.4));
                pp.WristPinPosition = mm(num(ps, "wristPinPositionMm", 0));
                pp.Displacement = cc(num(ps, "displacementCc", 0));
                piston->initialize(pp);

                const val slaveJournals = rs["slaveJournalsDeg"];
                ConnectingRod::Parameters rp;
                rp.mass = num(rs, "massKg", 0.6);
                rp.momentOfInertia = num(rs, "momentOfInertia", 0.0015);
                rp.centerOfMass = mm(num(rs, "centerOfMassMm", 0));
                rp.length = mm(num(rs, "lengthMm", 150));
                rp.slaveThrow = mm(num(rs, "slaveThrowMm", 0));
                rp.rodJournals = length(slaveJournals);
                rp.piston = piston;
                rp.master = nullptr;
                rp.journal = integer(js, "index", 0);
                rp.crankshaft = has(js, "masterCylinder")
                    ? nullptr
                    : engine->getCrankshaft(integer(js, "crankshaft", 0));
                rod->initialize(rp);
                for (int j = 0; j < rp.rodJournals; ++j) {
                    rod->setRodJournalAngle(j, deg(slaveJournals[j].as<double>()) + constants::pi / 2);
                }
            }

            // Cylinder head
            const val hs = bank["head"];
            const val vt = hs["valvetrain"];
            Crankshaft *crank0 = engine->getCrankshaft(0);
            Valvetrain *valvetrain = nullptr;
            if (str(vt, "type", "standard") == "vtec") {
                VtecValvetrain::Parameters vp;
                vp.intakeCamshaft = makeCamshaft(vt["intakeCam"], crank0);
                vp.exhaustCamshaft = makeCamshaft(vt["exhaustCam"], crank0);
                vp.vtecIntakeCamshaft = makeCamshaft(vt["vtecIntakeCam"], crank0);
                vp.vtexExhaustCamshaft = makeCamshaft(vt["vtecExhaustCam"], crank0);
                vp.minRpm = units::rpm(num(vt, "minRpm", 5800));
                vp.minSpeed = units::distance(num(vt, "minSpeedKmh", 16), units::km) / units::hour;
                vp.manifoldVacuum = units::pressure(1.0, units::atm)
                    - units::pressure(num(vt, "manifoldVacuumInHg", 5.0), units::inHg);
                vp.minThrottlePosition = num(vt, "minThrottlePosition", 0.3);
                vp.engine = engine;
                VtecValvetrain *v = new VtecValvetrain;
                v->initialize(vp);
                valvetrain = v;
            }
            else {
                StandardValvetrain::Parameters vp;
                vp.intakeCamshaft = makeCamshaft(vt["intakeCam"], crank0);
                vp.exhaustCamshaft = makeCamshaft(vt["exhaustCam"], crank0);
                StandardValvetrain *v = new StandardValvetrain;
                v->initialize(vp);
                valvetrain = v;
            }

            // Port flow: samples [[lift mm, cfm @ 28 inH2O]]
            auto portFlow = [](const val &f) {
                Function *function = new Function;
                const val samples = f["samples"];
                const int count = length(samples);
                function->initialize(count, mm(num(f, "filterRadiusMm", 1.27)));
                for (int k = 0; k < count; ++k) {
                    const val s = samples[k];
                    function->addSample(mm(s[0].as<double>()), GasSystem::k_28inH2O(s[1].as<double>()));
                }
                return function;
            };

            CylinderHead::Parameters hp;
            hp.Bank = cylinderBank;
            hp.Valvetrain = valvetrain;
            hp.IntakePortFlow = portFlow(hs["intakePortFlow"]);
            hp.ExhaustPortFlow = portFlow(hs["exhaustPortFlow"]);
            hp.CombustionChamberVolume = cc(num(hs, "chamberVolumeCc", 60));
            hp.IntakeRunnerVolume = cc(num(hs, "intakeRunnerVolumeCc", 150));
            hp.IntakeRunnerCrossSectionArea = cm2(num(hs, "intakeRunnerAreaCm2", 11.4));
            hp.ExhaustRunnerVolume = cc(num(hs, "exhaustRunnerVolumeCc", 150));
            hp.ExhaustRunnerCrossSectionArea = cm2(num(hs, "exhaustRunnerAreaCm2", 14.6));
            hp.FlipDisplay = boolean(hs, "flipDisplay", false);
            CylinderHead *head = engine->getHead(b);
            head->initialize(hp);

            for (int i = 0; i < n; ++i) {
                const val cyl = cylinders[i];
                head->setIntake(i, engine->getIntake(integer(cyl, "intake", 0)));
                head->setExhaustSystem(i, engine->getExhaustSystem(integer(cyl, "exhaust", 0)));
                head->setSoundAttenuation(i, num(cyl, "soundAttenuation", 1.0));
                head->setHeaderPrimaryLength(i, mm(num(cyl, "primaryLengthMm", 0)));
            }

            base += n;
        }

        // Master/slave rods (radial engines)
        base = 0;
        for (int b = 0; b < length(banks); ++b) {
            const val cylinders = banks[b]["cylinders"];
            for (int i = 0; i < length(cylinders); ++i) {
                const val js = cylinders[i]["journal"];
                if (has(js, "masterCylinder")) {
                    ConnectingRod *rod = engine->getConnectingRod(base + i);
                    ConnectingRod *master = engine->getConnectingRod(integer(js, "masterCylinder", 0));
                    rod->setMaster(master);
                    rod->setCrankshaft(master->getCrankshaft());
                }
            }
            base += length(cylinders);
        }

        // Ignition
        const val ign = spec["ignition"];
        IgnitionModule::Parameters ip;
        ip.crankshaft = engine->getCrankshaft(0);
        ip.cylinderCount = cylinderCount;
        ip.revLimit = units::rpm(num(ign, "revLimitRpm", 7000));
        ip.limiterDuration = num(ign, "limiterDurationS", 0.5);
        ip.timingCurve = makeFunction(ign["timingCurve"], units::rpm(1), units::deg, 1000);
        engine->getIgnitionModule()->initialize(ip);
        const val firing = ign["firingOrder"];
        for (int i = 0; i < length(firing); ++i) {
            const val f = firing[i];
            engine->getIgnitionModule()->setFiringOrder(
                integer(f, "cylinder", 0),
                deg(num(f, "angleDeg", 0)));
        }

        // Fuel
        const val fs = spec["fuel"];
        Fuel::Parameters fp;
        fp.name = str(fs, "name", "Gasoline");
        fp.molecularMass = units::mass(num(fs, "molecularMassG", 100.0), units::g);
        fp.energyDensity = units::energy(num(fs, "energyDensityKjPerG", 48.1), units::kJ) / units::mass(1.0, units::g);
        fp.density = units::mass(num(fs, "densityKgPerL", 0.755), units::kg) / units::volume(1.0, units::L);
        fp.molecularAfr = num(fs, "molecularAfr", 12.5);
        fp.maxBurningEfficiency = num(fs, "maxBurningEfficiency", 0.8);
        fp.burningEfficiencyRandomness = num(fs, "burningEfficiencyRandomness", 0.5);
        fp.lowEfficiencyAttenuation = num(fs, "lowEfficiencyAttenuation", 0.6);
        fp.maxTurbulenceEffect = num(fs, "maxTurbulenceEffect", 2.0);
        fp.maxDilutionEffect = num(fs, "maxDilutionEffect", 10.0);
        if (has(fs, "turbulenceToFlameSpeedRatio")) {
            fp.turbulenceToFlameSpeedRatio = makeFunction(fs["turbulenceToFlameSpeedRatio"], 1.0, 1.0, 5.0);
        }
        else {
            Function *t = new Function;
            t->initialize(10, 5.0);
            t->addSample(0.0, 3.0);
            for (int k = 1; k < 10; ++k) t->addSample(5.0 * k, 1.5 * 5.0 * k);
            fp.turbulenceToFlameSpeedRatio = t;
        }
        engine->getFuel()->initialize(fp);

        // Combustion chambers
        Function *meanPistonSpeedToTurbulence = new Function;
        meanPistonSpeedToTurbulence->initialize(30, 1);
        for (int i = 0; i < 30; ++i) {
            const double s = (double)i;
            meanPistonSpeedToTurbulence->addSample(s, s * 0.5);
        }

        CombustionChamber::Parameters ccp;
        ccp.CrankcasePressure = units::pressure(1.0, units::atm);
        ccp.Fuel = engine->getFuel();
        ccp.StartingPressure = units::pressure(1.0, units::atm);
        ccp.StartingTemperature = units::celcius(25.0);
        ccp.MeanPistonSpeedToTurbulence = meanPistonSpeedToTurbulence;
        for (int i = 0; i < engine->getCylinderCount(); ++i) {
            ccp.Piston = engine->getPiston(i);
            ccp.Head = engine->getHead(ccp.Piston->getCylinderBank()->getIndex());
            engine->getChamber(i)->initialize(ccp);
        }

        engine->calculateDisplacement();
        g.engine = engine;
    }

    void buildVehicle(const val &spec) {
        const val v = spec["vehicle"];
        Vehicle::Parameters p;
        p.mass = num(v, "massKg", 1400);
        p.dragCoefficient = num(v, "dragCoefficient", 0.3);
        p.crossSectionArea = num(v, "crossSectionAreaM2", 2.3);
        p.diffRatio = num(v, "diffRatio", 3.42);
        p.tireRadius = mm(num(v, "tireRadiusMm", 320));
        p.rollingResistance = num(v, "rollingResistanceN", 200);
        g.vehicle = new Vehicle;
        g.vehicle->initialize(p);

        const val t = spec["transmission"];
        const val gears = t["gears"];
        g.gearRatios.clear();
        for (int i = 0; i < length(gears); ++i) g.gearRatios.push_back(gears[i].as<double>());
        if (g.gearRatios.empty()) g.gearRatios.push_back(1.0);

        Transmission::Parameters tp;
        tp.GearCount = (int)g.gearRatios.size();
        tp.GearRatios = g.gearRatios.data();
        tp.MaxClutchTorque = units::torque(num(t, "maxClutchTorqueNm", 680), units::Nm);
        g.transmission = new Transmission;
        g.transmission->initialize(tp);
    }

    // ---------------------------------------------------------------------
    // Exported API
    // ---------------------------------------------------------------------

    // Loads an engine. Each module instance hosts exactly one engine; the
    // worker creates a fresh instance when switching engines, so objects are
    // intentionally never torn down here.
    val load(val spec, double audioSampleRate) {
        buildEngine(spec);
        buildVehicle(spec);

        g.audioSampleRate = audioSampleRate;
        g.simulator = g.engine->createSimulator(g.vehicle, g.transmission);
        g.simulator->setSimulationFrequency((int)g.engine->getSimulationFrequency());
        if (has(spec, "fluidSimulationSteps")) {
            static_cast<PistonEngineSimulator *>(g.simulator)->setFluidSimulationSteps(
                integer(spec, "fluidSimulationSteps", 8));
        }

        Synthesizer::AudioParameters audio = g.simulator->synthesizer().getAudioParameters();
        audio.inputSampleNoise = (float)g.engine->getInitialJitter();
        audio.airNoise = (float)g.engine->getInitialNoise();
        audio.dF_F_mix = (float)g.engine->getInitialHighFrequencyGain();
        g.simulator->synthesizer().setAudioParameters(audio);

        g.audioScratch.assign(8192, 0);
        g.audioOut.assign(8192, 0.0f);

        val info = val::object();
        info.set("name", g.engine->getName());
        info.set("cylinders", g.engine->getCylinderCount());
        info.set("exhaustSystems", g.engine->getExhaustSystemCount());
        info.set("displacementCc", g.engine->getDisplacement() / units::cc);
        info.set("redlineRpm", units::toRpm(g.engine->getRedline()));
        info.set("gears", (int)g.gearRatios.size());
        return info;
    }

    // Sets the impulse response for an exhaust channel from 16-bit PCM
    // samples previously copied into WASM memory.
    void setImpulseResponse(int exhaustIndex, uintptr_t samplesPtr, int sampleCount, double volume) {
        const int16_t *samples = reinterpret_cast<const int16_t *>(samplesPtr);
        g.simulator->synthesizer().initializeImpulseResponse(
            samples, (unsigned int)sampleCount, (float)volume, exhaustIndex);
    }

    // Advances the simulation by enough physics steps to produce roughly
    // `samples` audio samples. Returns the number of samples written to the
    // buffer exposed by audioBufferPtr().
    int process(int samples, double controlDt) {
        Simulator *sim = g.simulator;
        Engine *engine = g.engine;
        if (sim == nullptr) return 0;

        // --- Controls (same smoothing as the desktop app) ---------------
        g.speedSetting = g.targetSpeedSetting * 0.5 + 0.5 * g.speedSetting;
        engine->setSpeedControl(g.speedSetting);

        const double clutchRC = 0.001;
        const double clutch_s = controlDt / (controlDt + clutchRC);
        g.clutchPressure = g.clutchPressure * (1 - clutch_s) + g.targetClutchPressure * clutch_s;
        sim->getTransmission()->setClutchPressure(g.clutchPressure);

        if (sim->m_dyno.m_enabled && g.dynoAutoSweep && !sim->m_dyno.m_hold) {
            if (sim->getFilteredDynoTorque() > units::torque(1.0, units::ft_lb)) {
                g.dynoSpeed += units::rpm(500) * controlDt;
            }
            else {
                g.dynoSpeed *= (1 / (1 + controlDt));
            }

            if (g.dynoSpeed > engine->getRedline()) {
                sim->m_dyno.m_enabled = false;
                g.dynoSpeed = 0;
            }
        }
        if (!sim->m_dyno.m_enabled && !sim->m_dyno.m_hold) g.dynoSpeed = 0;
        g.dynoSpeed = std::clamp(g.dynoSpeed, engine->getDynoMinSpeed(), engine->getDynoMaxSpeed());
        sim->m_dyno.m_rotationSpeed = g.dynoSpeed;

        // --- Physics ----------------------------------------------------
        g.stepAccumulator +=
            samples * sim->getSimulationFrequency() * sim->getSimulationSpeed() / g.audioSampleRate;
        const int steps = (int)g.stepAccumulator;
        g.stepAccumulator -= steps;

        sim->startFixedFrame(steps);
        while (sim->simulateStep()) { /* void */ }

        // --- Audio ------------------------------------------------------
        sim->synthesizer().renderAvailable();
        sim->endFrame();

        const int maxOut = (int)g.audioOut.size();
        const int read = sim->readAudioOutput(maxOut, g.audioScratch.data());
        for (int i = 0; i < read; ++i) {
            g.audioOut[i] = g.audioScratch[i] / 32768.0f;
        }

        return read;
    }

    uintptr_t audioBufferPtr() {
        return reinterpret_cast<uintptr_t>(g.audioOut.data());
    }

    // --- Controls ---------------------------------------------------------

    void setThrottle(double v) { g.targetSpeedSetting = std::clamp(v, 0.0, 1.0); }
    void setStarter(bool on) { if (g.simulator) g.simulator->m_starterMotor.m_enabled = on; }
    void setIgnition(bool on) { if (g.engine) g.engine->getIgnitionModule()->m_enabled = on; }
    void setClutch(double pressure) { g.targetClutchPressure = std::clamp(pressure, 0.0, 1.0); }
    void setGear(int gear) {
        if (!g.transmission) return;
        g.transmission->changeGear(gear);
    }
    void setSimulationSpeed(double speed) { if (g.simulator) g.simulator->setSimulationSpeed(speed); }
    void setSimulationFrequency(int f) { if (g.simulator) g.simulator->setSimulationFrequency(std::clamp(f, 400, 400000)); }
    void setFluidSimulationSteps(int steps) {
        if (g.simulator) static_cast<PistonEngineSimulator *>(g.simulator)->setFluidSimulationSteps(std::clamp(steps, 1, 32));
    }

    void setDyno(bool enabled, bool hold, bool autoSweep, double rpm) {
        if (!g.simulator) return;
        g.simulator->m_dyno.m_enabled = enabled;
        g.simulator->m_dyno.m_hold = hold;
        g.dynoAutoSweep = autoSweep;
        // Hold keeps the current speed unless an explicit target is given.
        if (hold && rpm > 0) g.dynoSpeed = units::rpm(rpm);
        else if (!hold && !autoSweep) g.dynoSpeed = units::rpm(rpm);
    }

    void setAudioParameters(val p) {
        if (!g.simulator) return;
        Synthesizer::AudioParameters a = g.simulator->synthesizer().getAudioParameters();
        a.volume = (float)num(p, "volume", a.volume);
        a.convolution = (float)num(p, "convolution", a.convolution);
        a.dF_F_mix = (float)num(p, "highFreqGain", a.dF_F_mix);
        a.inputSampleNoise = (float)num(p, "jitter", a.inputSampleNoise);
        a.inputSampleNoiseFrequencyCutoff = (float)num(p, "jitterCutoff", a.inputSampleNoiseFrequencyCutoff);
        a.airNoise = (float)num(p, "airNoise", a.airNoise);
        a.airNoiseFrequencyCutoff = (float)num(p, "airNoiseCutoff", a.airNoiseFrequencyCutoff);
        a.levelerTarget = (float)num(p, "levelerTarget", a.levelerTarget);
        a.levelerMaxGain = (float)num(p, "levelerMaxGain", a.levelerMaxGain);
        a.levelerMinGain = (float)num(p, "levelerMinGain", a.levelerMinGain);
        g.simulator->synthesizer().setAudioParameters(a);
    }

    val getAudioParameters() {
        val o = val::object();
        if (!g.simulator) return o;
        const Synthesizer::AudioParameters a = g.simulator->synthesizer().getAudioParameters();
        o.set("volume", a.volume);
        o.set("convolution", a.convolution);
        o.set("highFreqGain", a.dF_F_mix);
        o.set("jitter", a.inputSampleNoise);
        o.set("jitterCutoff", a.inputSampleNoiseFrequencyCutoff);
        o.set("airNoise", a.airNoise);
        o.set("airNoiseCutoff", a.airNoiseFrequencyCutoff);
        o.set("levelerTarget", a.levelerTarget);
        o.set("levelerMaxGain", a.levelerMaxGain);
        o.set("levelerMinGain", a.levelerMinGain);
        return o;
    }

    // --- Telemetry ----------------------------------------------------------

    // Static geometry used by the engine view (meters / radians).
    val getGeometry() {
        val o = val::object();
        if (!g.engine) return o;
        Engine *e = g.engine;

        val banks = val::array();
        for (int b = 0; b < e->getCylinderBankCount(); ++b) {
            CylinderBank *bank = e->getCylinderBank(b);
            val bo = val::object();
            bo.set("x", bank->getX());
            bo.set("y", bank->getY());
            bo.set("angle", bank->getAngle());
            bo.set("bore", bank->getBore());
            bo.set("deckHeight", bank->getDeckHeight());
            bo.set("flip", e->getHead(b)->getFlipDisplay());
            banks.call<void>("push", bo);
        }
        o.set("banks", banks);

        val cranks = val::array();
        for (int c = 0; c < e->getCrankshaftCount(); ++c) {
            Crankshaft *crank = e->getCrankshaft(c);
            val co = val::object();
            co.set("x", crank->getPosX());
            co.set("y", crank->getPosY());
            co.set("throw", crank->getThrow());
            cranks.call<void>("push", co);
        }
        o.set("crankshafts", cranks);

        val cylinders = val::array();
        for (int i = 0; i < e->getCylinderCount(); ++i) {
            Piston *p = e->getPiston(i);
            ConnectingRod *r = e->getConnectingRod(i);
            val co = val::object();
            co.set("bank", p->getCylinderBank()->getIndex());
            co.set("index", p->getCylinderIndex());
            co.set("compressionHeight", p->getCompressionHeight());
            co.set("wristPin", p->getWristPinLocation());
            co.set("rodLength", r->getLength());
            co.set("bigEnd", r->getBigEndLocal());
            co.set("littleEnd", r->getLittleEndLocal());
            co.set("slave", r->getMasterRod() != nullptr);
            cylinders.call<void>("push", co);
        }
        o.set("cylinders", cylinders);
        return o;
    }

    // Live state; returned as a flat Float64Array view-compatible object to
    // keep the per-frame cost low.
    val getState() {
        val o = val::object();
        Simulator *sim = g.simulator;
        Engine *e = g.engine;
        if (!sim || !e) return o;

        o.set("rpm", e->getRpm());
        o.set("speedControl", e->getSpeedControl());
        o.set("throttle", e->getThrottle());
        o.set("manifoldPressure", e->getManifoldPressure());
        o.set("intakeAfr", e->getIntakeAfr());
        o.set("exhaustO2", e->getExhaustO2());
        o.set("intakeFlow", e->getIntakeFlowRate());
        o.set("dynoTorque", sim->getFilteredDynoTorque());
        o.set("dynoPower", sim->getDynoPower());
        o.set("dynoEnabled", sim->m_dyno.m_enabled);
        o.set("dynoHold", sim->m_dyno.m_hold);
        o.set("dynoSpeedRpm", units::toRpm(g.dynoSpeed));
        o.set("starter", sim->m_starterMotor.m_enabled);
        o.set("ignition", e->getIgnitionModule()->m_enabled);
        o.set("gear", sim->getTransmission()->getGear());
        o.set("clutch", sim->getTransmission()->getClutchPressure());
        o.set("vehicleSpeed", sim->getVehicle()->getSpeed());
        o.set("distance", sim->getVehicle()->getTravelledDistance());
        o.set("fuelConsumed", e->getTotalVolumeFuelConsumed());
        o.set("simulationFrequency", sim->getSimulationFrequency());
        o.set("simulationSpeed", sim->getSimulationSpeed());
        o.set("fluidSimulationSteps", static_cast<PistonEngineSimulator *>(sim)->getFluidSimulationSteps());
        o.set("latency", sim->getSynthesizerInputLatency());
        o.set("levelerGain", sim->synthesizer().getLevelerGain());

        val crankAngles = val::array();
        for (int c = 0; c < e->getCrankshaftCount(); ++c) {
            crankAngles.call<void>("push", e->getCrankshaft(c)->m_body.theta);
        }
        o.set("crankAngles", crankAngles);
        o.set("cycleAngle", e->getOutputCrankshaft()->getCycleAngle());

        const int n = e->getCylinderCount();
        val cyl = val::global("Float64Array").new_(n * 12);
        for (int i = 0; i < n; ++i) {
            Piston *p = e->getPiston(i);
            ConnectingRod *r = e->getConnectingRod(i);
            CombustionChamber *ch = e->getChamber(i);
            CylinderHead *head = e->getHead(p->getCylinderBank()->getIndex());
            const int ci = p->getCylinderIndex();
            const int k = i * 12;
            cyl.set(k + 0, p->m_body.p_x);
            cyl.set(k + 1, p->m_body.p_y);
            cyl.set(k + 2, r->m_body.p_x);
            cyl.set(k + 3, r->m_body.p_y);
            cyl.set(k + 4, r->m_body.theta);
            cyl.set(k + 5, ch->m_system.pressure());
            cyl.set(k + 6, ch->m_system.temperature());
            cyl.set(k + 7, ch->isLit() ? 1.0 : 0.0);
            cyl.set(k + 8, head->intakeValveLift(ci));
            cyl.set(k + 9, head->exhaustValveLift(ci));
            cyl.set(k + 10, ch->lastEventAfr());
            cyl.set(k + 11, ch->getVolume());
        }
        o.set("cylinders", cyl);
        return o;
    }
}

EMSCRIPTEN_BINDINGS(engine_sim) {
    emscripten::function("load", &load);
    emscripten::function("setImpulseResponse", &setImpulseResponse);
    emscripten::function("process", &process);
    emscripten::function("audioBufferPtr", &audioBufferPtr);
    emscripten::function("setThrottle", &setThrottle);
    emscripten::function("setStarter", &setStarter);
    emscripten::function("setIgnition", &setIgnition);
    emscripten::function("setClutch", &setClutch);
    emscripten::function("setGear", &setGear);
    emscripten::function("setSimulationSpeed", &setSimulationSpeed);
    emscripten::function("setSimulationFrequency", &setSimulationFrequency);
    emscripten::function("setFluidSimulationSteps", &setFluidSimulationSteps);
    emscripten::function("setDyno", &setDyno);
    emscripten::function("setAudioParameters", &setAudioParameters);
    emscripten::function("getAudioParameters", &getAudioParameters);
    emscripten::function("getGeometry", &getGeometry);
    emscripten::function("getState", &getState);
}
