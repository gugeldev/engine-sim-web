import type {
  CamSpec,
  Curve,
  CylinderSpec,
  EngineSpec,
  ExhaustSpec,
  IntakeSpec,
  PortFlow,
} from "../sim/spec";
import {
  k28inH2O,
  kCarb,
  type MrCamshaft,
  type MrCylinder,
  type MrExhaust,
  type MrFunction,
  type MrIntake,
  type MrResult,
  MrRuntimeError,
} from "./interpreter";

/** Converts the SI-unit object graph produced by the interpreter into an EngineSpec. */

const RPM = 0.104719755; // rad/s per rpm (units.mr)
const DEG = Math.PI / 180;
const INHG = 3386.3886666666713;
const ATM = 101325;
const K_CARB_1 = kCarb(1);
const K_28_1 = k28inH2O(1);

const mm = (m: number) => m * 1000;
const deg = (rad: number) => rad / DEG;
const rpm = (radPerSec: number) => radPerSec / RPM;
const cc = (m3: number) => m3 * 1e6;
const cm2 = (m2: number) => m2 * 1e4;
const carbCfm = (k: number) => k / K_CARB_1;
const benchCfm = (k: number) => k / K_28_1;

/** Maps engine-sim sound library files to the ids shipped in public/ir. */
const IR_FILES: Record<string, string> = {
  "smooth/smooth_39.wav": "smooth-39",
  "sharp/sharp_01.wav": "sharp-01",
  "new/mild_exhaust.wav": "mild-exhaust",
  "new/mild_exhaust_reverb.wav": "mild-exhaust-reverb",
  "new/minimal_muffling_01.wav": "minimal-muffling-01",
  "new/minimal_muffling_02.wav": "minimal-muffling-02",
  "new/minimal_muffling_03.wav": "minimal-muffling-03",
  "archive/test_engine_14_eq_adjusted_16.wav": "real-engine-14",
  "archive/test_engine_15_eq_adjusted_16.wav": "real-engine-15",
  "archive/test_engine_16_eq_adjusted_16.wav": "real-engine-16",
};

function impulseId(filename: string): string {
  const key = Object.keys(IR_FILES).find((k) => filename.replace(/\\/g, "/").endsWith(k));
  return key ? IR_FILES[key] : "smooth-39";
}

const curve = (
  f: MrFunction,
  xScale: (v: number) => number,
  yScale: (v: number) => number,
): Curve => ({
  filterRadius: xScale(f.filterRadius),
  samples: f.samples.map(([x, y]) => [xScale(x), yScale(y)] as [number, number]),
});

function cam(c: MrCamshaft): CamSpec {
  const lobe = c.lobe.harmonic
    ? {
        type: "harmonic" as const,
        durationAt50ThouDeg: deg(c.lobe.harmonic.durationAt50Thou),
        gamma: c.lobe.harmonic.gamma,
        liftMm: mm(c.lobe.harmonic.lift),
        steps: c.lobe.harmonic.steps,
      }
    : {
        type: "samples" as const,
        filterRadius: deg(c.lobe.filterRadius),
        samples: c.lobe.samples
          .map(([x, y]) => [deg(x), mm(y)] as [number, number])
          .sort((a, b) => a[0] - b[0]),
      };
  return {
    advanceDeg: deg(c.advance),
    baseRadiusMm: mm(c.baseRadius),
    lobe,
    lobesDeg: c.lobes.map(deg),
  };
}

function portFlow(f: MrFunction): PortFlow {
  return {
    filterRadiusMm: mm(f.filterRadius),
    samples: f.samples.map(([x, y]) => [mm(x), benchCfm(y)] as [number, number]),
  };
}

export function toSpec(result: MrResult): EngineSpec {
  const e = result.engine;
  if (!e) throw new MrRuntimeError("o script não chamou set_engine()");
  if (e.crankshafts.length === 0) throw new MrRuntimeError("motor sem virabrequim");
  if (!e.ignition) throw new MrRuntimeError("motor sem módulo de ignição");

  const allCylinders: MrCylinder[] = e.banks.flatMap((b) => b.cylinders);
  const intakes: MrIntake[] = [];
  const exhausts: MrExhaust[] = [];
  for (const c of allCylinders) {
    if (!intakes.includes(c.intake)) intakes.push(c.intake);
    if (!exhausts.includes(c.exhaust)) exhausts.push(c.exhaust);
  }

  const globalIndex = (bankIndex: number, cylinder: number) =>
    e.banks.slice(0, bankIndex).reduce((n, b) => n + b.cylinders.length, 0) + cylinder;

  const banks = e.banks.map((bank, bi) => {
    const head = bank.head;
    if (!head) throw new MrRuntimeError(`bancada ${bi + 1} sem cabeçote`);
    const vt = head.valvetrain;
    const valvetrain =
      vt.t === "vtec_valvetrain"
        ? {
            type: "vtec" as const,
            intakeCam: cam(vt.intake),
            exhaustCam: cam(vt.exhaust),
            vtecIntakeCam: cam(vt.vtecIntake),
            vtecExhaustCam: cam(vt.vtecExhaust),
            minRpm: rpm(vt.p.min_rpm),
            minSpeedKmh: vt.p.min_speed * 3.6,
            manifoldVacuumInHg: (ATM - vt.p.manifold_vacuum) / INHG,
            minThrottlePosition: vt.p.min_throttle_position,
          }
        : { type: "standard" as const, intakeCam: cam(vt.intake), exhaustCam: cam(vt.exhaust) };

    const cylinders: CylinderSpec[] = bank.cylinders.map((c) => {
      const j = c.journal;
      let journal: CylinderSpec["journal"];
      if (j.crank) {
        journal = {
          crankshaft: e.crankshafts.indexOf(j.crank),
          index: j.crank.journals.indexOf(j),
        };
      } else if (j.rod) {
        const master = allCylinders.findIndex((other) => other.rod === j.rod);
        if (master < 0) throw new MrRuntimeError("biela mestre não encontrada");
        journal = { masterCylinder: master, index: j.rod.journals.indexOf(j) };
      } else {
        throw new MrRuntimeError("munhão de biela não conectado a virabrequim");
      }
      return {
        piston: {
          massKg: c.piston.p.mass,
          compressionHeightMm: mm(c.piston.p.compression_height),
          wristPinPositionMm: mm(c.piston.p.wrist_pin_position),
          displacementCc: cc(c.piston.p.displacement),
          blowbyCfm: benchCfm(c.piston.p.blowby),
        },
        rod: {
          massKg: c.rod.p.mass,
          momentOfInertia: c.rod.p.moment_of_inertia,
          centerOfMassMm: mm(c.rod.p.center_of_mass),
          lengthMm: mm(c.rod.p.length),
          slaveThrowMm: mm(c.rod.p.slave_throw),
          slaveJournalsDeg: c.rod.journals.length
            ? c.rod.journals.map((rj) => deg(rj.angle))
            : undefined,
        },
        journal,
        intake: intakes.indexOf(c.intake),
        exhaust: exhausts.indexOf(c.exhaust),
        soundAttenuation: c.soundAttenuation,
        primaryLengthMm: mm(c.primaryLength),
      };
    });

    return {
      angleDeg: deg(bank.p.angle),
      boreMm: mm(bank.p.bore),
      deckHeightMm: mm(bank.p.deck_height),
      xMm: mm(bank.p.position_x),
      yMm: mm(bank.p.position_y),
      displayDepth: bank.p.display_depth,
      head: {
        chamberVolumeCc: cc(head.p.chamber_volume),
        intakeRunnerVolumeCc: cc(head.p.intake_runner_volume),
        intakeRunnerAreaCm2: cm2(head.p.intake_runner_cross_section_area),
        exhaustRunnerVolumeCc: cc(head.p.exhaust_runner_volume),
        exhaustRunnerAreaCm2: cm2(head.p.exhaust_runner_cross_section_area),
        flipDisplay: head.flip,
        intakePortFlow: portFlow(head.intakeFlow),
        exhaustPortFlow: portFlow(head.exhaustFlow),
        valvetrain,
      },
      cylinders,
    };
  });

  const firingOrder: EngineSpec["ignition"]["firingOrder"] = [];
  for (const post of e.ignition.posts) {
    for (const conn of post.wire.connections) {
      const bankIndex = e.banks.indexOf(conn.bank);
      if (bankIndex < 0) continue;
      firingOrder.push({ cylinder: globalIndex(bankIndex, conn.index), angleDeg: deg(post.angle) });
    }
  }

  const intakeSpecs: IntakeSpec[] = intakes.map((i) => ({
    plenumVolumeL: i.p.plenum_volume * 1000,
    plenumAreaCm2: cm2(i.p.plenum_cross_section_area),
    intakeFlowCfm: carbCfm(i.p.intake_flow_rate),
    idleFlowCfm: carbCfm(i.p.idle_flow_rate),
    runnerFlowCfm: carbCfm(i.p.runner_flow_rate),
    molecularAfr: i.p.molecular_afr,
    idleThrottlePlatePosition: i.p.idle_throttle_plate_position,
    runnerLengthMm: mm(i.p.runner_length),
    velocityDecay: i.p.velocity_decay,
  }));

  const exhaustSpecs: ExhaustSpec[] = exhausts.map((x) => ({
    lengthMm: mm(x.p.length),
    collectorAreaCm2: cm2(x.p.collector_cross_section_area),
    outletFlowCfm: carbCfm(x.p.outlet_flow_rate),
    primaryTubeLengthMm: mm(x.p.primary_tube_length),
    primaryFlowCfm: carbCfm(x.p.primary_flow_rate),
    velocityDecay: x.p.velocity_decay,
    audioVolume: x.p.audio_volume,
    impulseResponse: impulseId(x.impulse?.filename ?? ""),
    impulseVolume: x.impulse?.volume ?? 0.001,
  }));

  const throttle =
    e.throttle?.t === "governor"
      ? {
          type: "governor" as const,
          minSpeedRpm: rpm(e.throttle.p.min_speed),
          maxSpeedRpm: rpm(e.throttle.p.max_speed),
          minV: e.throttle.p.min_v,
          maxV: e.throttle.p.max_v,
          kS: e.throttle.p.k_s,
          kD: e.throttle.p.k_d,
          gamma: e.throttle.p.gamma,
        }
      : {
          type: "direct" as const,
          gamma: e.throttle?.t === "direct_throttle_linkage" ? e.throttle.gamma : 1,
        };

  const fuel = e.fuel;
  const vehicle = result.vehicle?.p;
  const transmission = result.transmission;

  return {
    name: e.name,
    redlineRpm: rpm(e.p.redline),
    starterTorqueNm: e.p.starter_torque,
    starterSpeedRpm: rpm(e.p.starter_speed),
    dynoMinRpm: rpm(e.p.dyno_min_speed),
    dynoMaxRpm: rpm(e.p.dyno_max_speed),
    dynoHoldStepRpm: rpm(e.p.dyno_hold_step),
    simulationFrequency: e.p.simulation_frequency || 10000,
    hfGain: e.p.hf_gain,
    jitter: e.p.jitter,
    noise: e.p.noise,
    throttle,
    fuel: fuel
      ? {
          name: fuel.name,
          molecularMassG: fuel.p.molecular_mass * 1000,
          energyDensityKjPerG: fuel.p.energy_density / 1e6,
          densityKgPerL: fuel.p.density / 1000,
          molecularAfr: fuel.p.molecular_afr,
          maxBurningEfficiency: fuel.p.max_burning_efficiency,
          burningEfficiencyRandomness: fuel.p.burning_efficiency_randomness,
          lowEfficiencyAttenuation: fuel.p.low_efficiency_attenuation,
          maxTurbulenceEffect: fuel.p.max_turbulence_effect,
          maxDilutionEffect: fuel.p.max_dilution_effect,
          turbulenceToFlameSpeedRatio: fuel.turbulence
            ? curve(
                fuel.turbulence,
                (x) => x,
                (y) => y,
              )
            : undefined,
        }
      : {},
    crankshafts: e.crankshafts.map((c) => ({
      throwMm: mm(c.p.throw),
      flywheelMassKg: c.p.flywheel_mass,
      massKg: c.p.mass,
      frictionTorqueNm: c.p.friction_torque,
      momentOfInertia: c.p.moment_of_inertia,
      xMm: mm(c.p.position_x),
      yMm: mm(c.p.position_y),
      tdcDeg: deg(c.p.tdc),
      journalsDeg: c.journals.map((j) => deg(j.angle)),
    })),
    banks,
    intakes: intakeSpecs,
    exhausts: exhaustSpecs,
    ignition: {
      timingCurve: curve(e.ignition.timing, rpm, deg),
      revLimitRpm: rpm(e.ignition.revLimit),
      limiterDurationS: e.ignition.limiterDuration,
      firingOrder,
    },
    vehicle: vehicle
      ? {
          massKg: vehicle.mass,
          dragCoefficient: vehicle.drag_coefficient,
          crossSectionAreaM2: vehicle.cross_sectional_area,
          diffRatio: vehicle.diff_ratio,
          tireRadiusMm: mm(vehicle.tire_radius),
          rollingResistanceN: vehicle.rolling_resistance,
        }
      : {
          massKg: 1400,
          dragCoefficient: 0.3,
          crossSectionAreaM2: 2.3,
          diffRatio: 3.42,
          tireRadiusMm: 320,
          rollingResistanceN: 200,
        },
    transmission: transmission
      ? { maxClutchTorqueNm: transmission.maxClutchTorque, gears: transmission.gears }
      : { maxClutchTorqueNm: 680, gears: [3.5, 2.2, 1.5, 1.1, 0.9] },
  };
}
