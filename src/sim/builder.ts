import {
  type CamSpec,
  type CrankshaftSpec,
  type Curve,
  type EngineSpec,
  type ExhaustSpec,
  type FuelSpec,
  type HarmonicLobe,
  type HeadSpec,
  type IntakeSpec,
  type PortFlow,
  rodMoment,
  type TransmissionSpec,
  type VehicleSpec,
} from "./spec";

/**
 * Compact way to describe a "regular" piston engine (one crankshaft, one head
 * design, harmonic cam lobes). Most engine-sim example scripts follow this
 * shape: every cylinder has a firing angle θ (crank degrees in the 720° cycle)
 * and its cam lobes sit at 360 + intakeCenter + θ and 360 − exhaustCenter + θ.
 */
export type CylinderDef = {
  /** Index into `journalsDeg`. */
  journal: number;
  /** Firing angle in the 4-stroke cycle (0–720°). */
  firingDeg: number;
  exhaust?: number;
  intake?: number;
  primaryLengthMm?: number;
  soundAttenuation?: number;
  blowbyCfm?: number;
};

export type BankDef = {
  angleDeg: number;
  flipDisplay?: boolean;
  cylinders: CylinderDef[];
};

export type EngineDef = {
  name: string;
  redlineRpm: number;
  revLimitRpm: number;
  limiterDurationS: number;
  starterTorqueNm: number;
  starterSpeedRpm?: number;
  simulationFrequency?: number;
  hfGain?: number;
  jitter?: number;
  noise?: number;
  throttleGamma?: number;
  fuel?: FuelSpec;

  boreMm: number;
  strokeMm: number;
  rodLengthMm: number;
  rodMassKg: number;
  pistonMassKg: number;
  compressionHeightMm: number;
  crank: Omit<CrankshaftSpec, "throwMm" | "journalsDeg">;
  journalsDeg: number[];
  banks: BankDef[];

  head: Omit<HeadSpec, "valvetrain" | "flipDisplay" | "intakePortFlow" | "exhaustPortFlow"> & {
    intakePortFlow: PortFlow;
    exhaustPortFlow: PortFlow;
  };
  cam: {
    intakeLobe: HarmonicLobe;
    exhaustLobe: HarmonicLobe;
    intakeCenterDeg: number;
    exhaustCenterDeg: number;
    baseRadiusMm: number;
    advanceDeg?: number;
  };

  intakes: IntakeSpec[];
  exhausts: ExhaustSpec[];
  timingCurve: Curve;
  vehicle: VehicleSpec;
  transmission: TransmissionSpec;
};

export function buildEngine(def: EngineDef): EngineSpec {
  let global = 0;
  const firingOrder: EngineSpec["ignition"]["firingOrder"] = [];

  const banks = def.banks.map((bank) => {
    const cams = (lobe: HarmonicLobe, kind: "intake" | "exhaust"): CamSpec => ({
      advanceDeg: def.cam.advanceDeg ?? 0,
      baseRadiusMm: def.cam.baseRadiusMm,
      lobe,
      lobesDeg: bank.cylinders.map((c) =>
        kind === "intake"
          ? 360 + def.cam.intakeCenterDeg + c.firingDeg
          : 360 - def.cam.exhaustCenterDeg + c.firingDeg,
      ),
    });

    const cylinders = bank.cylinders.map((c) => {
      firingOrder.push({ cylinder: global++, angleDeg: c.firingDeg });
      return {
        piston: {
          massKg: def.pistonMassKg,
          compressionHeightMm: def.compressionHeightMm,
          blowbyCfm: c.blowbyCfm ?? 0,
        },
        rod: {
          massKg: def.rodMassKg,
          momentOfInertia: rodMoment(def.rodMassKg, def.rodLengthMm),
          lengthMm: def.rodLengthMm,
        },
        journal: { crankshaft: 0, index: c.journal },
        intake: c.intake ?? 0,
        exhaust: c.exhaust ?? 0,
        soundAttenuation: c.soundAttenuation ?? 1,
        primaryLengthMm: c.primaryLengthMm ?? 0,
      };
    });

    return {
      angleDeg: bank.angleDeg,
      boreMm: def.boreMm,
      deckHeightMm: def.strokeMm / 2 + def.rodLengthMm + def.compressionHeightMm,
      head: {
        ...def.head,
        flipDisplay: bank.flipDisplay ?? false,
        valvetrain: {
          type: "standard" as const,
          intakeCam: cams(def.cam.intakeLobe, "intake"),
          exhaustCam: cams(def.cam.exhaustLobe, "exhaust"),
        },
      },
      cylinders,
    };
  });

  return {
    name: def.name,
    redlineRpm: def.redlineRpm,
    starterTorqueNm: def.starterTorqueNm,
    starterSpeedRpm: def.starterSpeedRpm ?? 200,
    simulationFrequency: def.simulationFrequency ?? 10000,
    hfGain: def.hfGain ?? 0.01,
    jitter: def.jitter ?? 0.5,
    noise: def.noise ?? 1,
    throttle: { type: "direct", gamma: def.throttleGamma ?? 1 },
    fuel: def.fuel ?? {},
    crankshafts: [{ ...def.crank, throwMm: def.strokeMm / 2, journalsDeg: def.journalsDeg }],
    banks,
    intakes: def.intakes,
    exhausts: def.exhausts,
    ignition: {
      timingCurve: def.timingCurve,
      revLimitRpm: def.revLimitRpm,
      limiterDurationS: def.limiterDurationS,
      firingOrder,
    },
    vehicle: def.vehicle,
    transmission: def.transmission,
  };
}

/** Timing curve helper: [rpm, degrees] pairs with the usual 1000 rpm smoothing. */
export const timing = (samples: [number, number][]): Curve => ({ filterRadius: 1000, samples });

/** Default turbulence-to-flame-speed curve used by many of the ATG engines. */
export const fastBurn: Curve = {
  filterRadius: 5,
  samples: [
    [0, 3],
    [5, 7.5],
    [10, 17.5],
    [15, 30],
    [20, 40],
    [25, 50],
    [30, 60],
    [35, 70],
    [40, 80],
    [45, 90],
  ],
};

/** Port flow bench data shared by many ATG example heads ([thou, cfm]). */
export const atgIntakeFlow: [number, number][] = [
  [0, 0],
  [50, 58],
  [100, 103],
  [150, 156],
  [200, 214],
  [250, 249],
  [300, 268],
  [350, 280],
  [400, 280],
  [450, 281],
];

export const atgExhaustFlow: [number, number][] = [
  [0, 0],
  [50, 37],
  [100, 72],
  [150, 113],
  [200, 160],
  [250, 196],
  [300, 222],
  [350, 235],
  [400, 245],
  [450, 246],
];
