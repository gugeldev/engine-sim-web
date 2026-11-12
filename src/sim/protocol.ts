import type { EngineSpec } from "./spec";

export const SAMPLE_RATE = 44100;

/** Synthesizer parameters (Synthesizer::AudioParameters in the core). */
export type AudioParams = {
  volume: number;
  convolution: number;
  highFreqGain: number;
  jitter: number;
  jitterCutoff: number;
  airNoise: number;
  airNoiseCutoff: number;
  levelerTarget: number;
  levelerMaxGain: number;
  levelerMinGain: number;
};

export type EngineInfo = {
  name: string;
  cylinders: number;
  exhaustSystems: number;
  displacementCc: number;
  redlineRpm: number;
  gears: number;
};

export type EngineGeometry = {
  banks: { x: number; y: number; angle: number; bore: number; deckHeight: number; flip: boolean }[];
  crankshafts: { x: number; y: number; throw: number }[];
  cylinders: {
    bank: number;
    index: number;
    compressionHeight: number;
    wristPin: number;
    rodLength: number;
    bigEnd: number;
    littleEnd: number;
    /** Rod rides on a master rod instead of the crankshaft (radials). */
    slave: boolean;
  }[];
};

/** Per-cylinder values packed in RawEngineState.cylinders (stride CYLINDER_STRIDE). */
export const CYLINDER_STRIDE = 12;
export const Cyl = {
  pistonX: 0,
  pistonY: 1,
  rodX: 2,
  rodY: 3,
  rodTheta: 4,
  pressure: 5,
  temperature: 6,
  lit: 7,
  intakeLift: 8,
  exhaustLift: 9,
  afr: 10,
  volume: 11,
} as const;

export type RawEngineState = {
  rpm: number;
  speedControl: number;
  throttle: number;
  manifoldPressure: number;
  intakeAfr: number;
  exhaustO2: number;
  intakeFlow: number;
  dynoTorque: number;
  dynoPower: number;
  dynoEnabled: boolean;
  dynoHold: boolean;
  dynoSpeedRpm: number;
  starter: boolean;
  ignition: boolean;
  gear: number;
  clutch: number;
  vehicleSpeed: number;
  distance: number;
  fuelConsumed: number;
  simulationFrequency: number;
  simulationSpeed: number;
  fluidSimulationSteps: number;
  latency: number;
  levelerGain: number;
  crankAngles: number[];
  cycleAngle: number;
  cylinders: Float64Array;
};

export type EngineState = RawEngineState & {
  /** Fraction of real time spent computing (1 = can't keep up). */
  load: number;
  /** Samples waiting in the audio worklet queue. */
  bufferedSamples: number;
  underruns: number;
};

export type ImpulseResponseData = { samples: Int16Array; volume: number };

export type Quality = "auto" | "high" | "medium" | "low";

export type Controls = {
  throttle: number;
  starter: boolean;
  ignition: boolean;
  clutch: number;
  gear: number;
  simulationSpeed: number;
  dyno: { enabled: boolean; hold: boolean; autoSweep: boolean; rpm: number };
};

export type ControlsPatch = Partial<Omit<Controls, "dyno">> & { dyno?: Partial<Controls["dyno"]> };

export type ToWorker =
  | { type: "init"; port: MessagePort }
  | {
      type: "load";
      spec: EngineSpec;
      impulseResponses: ImpulseResponseData[];
      audio?: Partial<AudioParams>;
    }
  | { type: "controls"; controls: ControlsPatch }
  | { type: "audio"; params: Partial<AudioParams> }
  | { type: "impulse"; exhaust: number; data: ImpulseResponseData }
  | { type: "quality"; quality: Quality }
  | { type: "pause"; paused: boolean };

export type FromWorker =
  | { type: "ready" }
  | {
      type: "loaded";
      info: EngineInfo;
      geometry: EngineGeometry;
      audio: AudioParams;
    }
  | { type: "state"; state: EngineState }
  | { type: "error"; message: string };

/** Messages between worker and audio worklet. */
export type ToWorklet =
  | { type: "chunk"; samples: Float32Array }
  /** Drops queued audio and starts a new accounting epoch. */
  | { type: "flush"; epoch: number };
export type FromWorklet = {
  type: "consumed";
  epoch: number;
  consumed: number;
  queued: number;
  underruns: number;
};
