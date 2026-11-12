/**
 * Engine description consumed by the WASM core (core/bindings/bindings.cpp).
 *
 * This replaces the Piranha (.mr) scripts of the original engine-sim. Every
 * numeric field carries its unit in the name; the C++ side converts to SI.
 * Flow values are in CFM: intake/exhaust use the carburetor rating
 * (1.5 inHg drop) and port flow / blowby use flow-bench numbers (28 inH2O).
 */

export type Curve = {
  /** Smoothing radius, in the same unit as the x values. */
  filterRadius?: number;
  samples: [number, number][];
};

export type PortFlow = {
  filterRadiusMm?: number;
  /** [valve lift mm, flow cfm @ 28 inH2O] */
  samples: [number, number][];
};

export type HarmonicLobe = {
  type: "harmonic";
  durationAt50ThouDeg: number;
  gamma: number;
  liftMm: number;
  steps?: number;
};

export type SampledLobe = {
  type: "samples";
  filterRadius?: number;
  /** [cam angle deg, lift mm] */
  samples: [number, number][];
};

export type CamSpec = {
  advanceDeg: number;
  baseRadiusMm: number;
  lobe: HarmonicLobe | SampledLobe;
  /** Lobe centerlines in crankshaft degrees. */
  lobesDeg: number[];
};

export type ValvetrainSpec =
  | { type: "standard"; intakeCam: CamSpec; exhaustCam: CamSpec }
  | {
      type: "vtec";
      intakeCam: CamSpec;
      exhaustCam: CamSpec;
      vtecIntakeCam: CamSpec;
      vtecExhaustCam: CamSpec;
      minRpm: number;
      minSpeedKmh: number;
      manifoldVacuumInHg: number;
      minThrottlePosition: number;
    };

export type HeadSpec = {
  chamberVolumeCc: number;
  intakeRunnerVolumeCc: number;
  intakeRunnerAreaCm2: number;
  exhaustRunnerVolumeCc: number;
  exhaustRunnerAreaCm2: number;
  flipDisplay?: boolean;
  intakePortFlow: PortFlow;
  exhaustPortFlow: PortFlow;
  valvetrain: ValvetrainSpec;
};

export type PistonSpec = {
  massKg: number;
  compressionHeightMm: number;
  wristPinPositionMm?: number;
  displacementCc?: number;
  blowbyCfm?: number;
};

export type RodSpec = {
  massKg: number;
  momentOfInertia: number;
  centerOfMassMm?: number;
  lengthMm: number;
  slaveThrowMm?: number;
  /** Journals on a master rod (radial engines). */
  slaveJournalsDeg?: number[];
};

export type JournalRef =
  | { crankshaft: number; index: number }
  /** Slave rod riding on a master rod: global cylinder index of the master. */
  | { masterCylinder: number; index: number };

export type CylinderSpec = {
  piston: PistonSpec;
  rod: RodSpec;
  journal: JournalRef;
  intake: number;
  exhaust: number;
  soundAttenuation?: number;
  primaryLengthMm?: number;
};

export type BankSpec = {
  angleDeg: number;
  boreMm: number;
  deckHeightMm: number;
  xMm?: number;
  yMm?: number;
  displayDepth?: number;
  head: HeadSpec;
  cylinders: CylinderSpec[];
};

export type CrankshaftSpec = {
  throwMm: number;
  flywheelMassKg: number;
  massKg: number;
  frictionTorqueNm: number;
  momentOfInertia: number;
  xMm?: number;
  yMm?: number;
  tdcDeg: number;
  journalsDeg: number[];
};

export type IntakeSpec = {
  plenumVolumeL: number;
  plenumAreaCm2: number;
  intakeFlowCfm: number;
  idleFlowCfm: number;
  runnerFlowCfm: number;
  molecularAfr?: number;
  idleThrottlePlatePosition: number;
  runnerLengthMm: number;
  velocityDecay: number;
};

export type ExhaustSpec = {
  lengthMm: number;
  collectorAreaCm2: number;
  outletFlowCfm: number;
  primaryTubeLengthMm: number;
  primaryFlowCfm: number;
  velocityDecay: number;
  audioVolume: number;
  /** Id of an impulse response from the sound library (see sounds.ts). */
  impulseResponse: string;
  impulseVolume: number;
};

export type FuelSpec = {
  name?: string;
  molecularMassG?: number;
  energyDensityKjPerG?: number;
  densityKgPerL?: number;
  molecularAfr?: number;
  maxBurningEfficiency?: number;
  burningEfficiencyRandomness?: number;
  lowEfficiencyAttenuation?: number;
  maxTurbulenceEffect?: number;
  maxDilutionEffect?: number;
  turbulenceToFlameSpeedRatio?: Curve;
};

export type ThrottleSpec =
  | { type: "direct"; gamma: number }
  | {
      type: "governor";
      minSpeedRpm: number;
      maxSpeedRpm: number;
      minV: number;
      maxV: number;
      kS: number;
      kD: number;
      gamma: number;
    };

export type IgnitionSpec = {
  /** [rpm, advance deg] */
  timingCurve: Curve;
  revLimitRpm: number;
  limiterDurationS: number;
  firingOrder: { cylinder: number; angleDeg: number }[];
};

export type VehicleSpec = {
  massKg: number;
  dragCoefficient: number;
  crossSectionAreaM2: number;
  diffRatio: number;
  tireRadiusMm: number;
  rollingResistanceN: number;
};

export type TransmissionSpec = {
  maxClutchTorqueNm: number;
  gears: number[];
};

export type EngineSpec = {
  name: string;
  redlineRpm: number;
  starterTorqueNm: number;
  starterSpeedRpm: number;
  dynoMinRpm?: number;
  dynoMaxRpm?: number;
  dynoHoldStepRpm?: number;
  simulationFrequency: number;
  fluidSimulationSteps?: number;
  hfGain: number;
  jitter: number;
  noise: number;
  throttle: ThrottleSpec;
  fuel: FuelSpec;
  crankshafts: CrankshaftSpec[];
  banks: BankSpec[];
  intakes: IntakeSpec[];
  exhausts: ExhaustSpec[];
  ignition: IgnitionSpec;
  vehicle: VehicleSpec;
  transmission: TransmissionSpec;
};

// ---------------------------------------------------------------------------
// Unit helpers for writing presets (mirrors es/constants/units.mr)
// ---------------------------------------------------------------------------

export const inch = (v: number) => v * 25.4; // -> mm
export const thou = (v: number) => v * 0.0254; // -> mm
export const lb = (v: number) => v * 0.45359237; // -> kg
export const g = (v: number) => v / 1000; // -> kg
export const lbFt = (v: number) => v * 1.3558179483314; // -> Nm
export const sqInch = (v: number) => v * 6.4516; // -> cm2

/** Moment of inertia of a solid disk; mass kg, radius mm -> kg·m² */
export const diskMoment = (massKg: number, radiusMm: number) =>
  0.5 * massKg * (radiusMm / 1000) ** 2;

/** Moment of inertia of a rod about its center; mass kg, length mm -> kg·m² */
export const rodMoment = (massKg: number, lengthMm: number) =>
  (1 / 12) * massKg * (lengthMm / 1000) ** 2;

export const circleAreaCm2 = (radiusMm: number) => Math.PI * (radiusMm / 10) ** 2;

/** Builds a port flow table from flow-bench data in thou / cfm. */
export const flowTable = (
  points: [number, number][],
  options: { liftScale?: number; flowScale?: number } = {},
): PortFlow => ({
  filterRadiusMm: thou(50),
  samples: points.map(([lift, cfm]) => [
    thou(lift * (options.liftScale ?? 1)),
    cfm * (options.flowScale ?? 1),
  ]),
});
