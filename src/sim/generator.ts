import {
  atgExhaustFlow,
  atgIntakeFlow,
  type BankDef,
  buildEngine,
  type CylinderDef,
  fastBurn,
  timing,
} from "./builder";
import { builtinImpulseResponses } from "./sounds";
import { diskMoment, type EngineSpec, flowTable } from "./spec";

/**
 * Parametric engine generator.
 *
 * Geometry rules (verified against engine-sim's example scripts):
 * - crankshaft TDC = 90° + angle of bank 0;
 * - a cylinder whose bank is rotated Δ from bank 0 and that fires at crank
 *   angle φ needs its rod journal at (φ + Δ) mod 360.
 * Each cylinder gets its own journal, so any firing pattern is possible; the
 * classic configurations below use their real firing orders and intervals.
 */

export type Layout = "inline" | "v" | "boxer";

export type Config = {
  id: string;
  label: string;
  layout: Layout;
  cylinders: number;
  /** Default V angle (V layouts). */
  vAngle?: number;
  /** Firing sequence as [bank, position] pairs. */
  order: [number, number][];
  /** Firing angle of each step in `order` (crank degrees, 0–720). */
  angles?: number[];
  note: string;
};

const even = (n: number) => Array.from({ length: n }, (_, k) => (k * 720) / n);
const inl = (seq: number[]): [number, number][] => seq.map((c) => [0, c - 1]);
/** GM-style numbering: odd cylinders on bank 0, even on bank 1, front to back. */
const gm = (seq: number[]): [number, number][] =>
  seq.map((c) => [(c - 1) % 2, Math.floor((c - 1) / 2)]);
/** Bank-major numbering: 1..n/2 on bank 0, rest on bank 1. */
const split = (n: number, seq: number[]): [number, number][] =>
  seq.map((c) => (c <= n / 2 ? [0, c - 1] : [1, c - 1 - n / 2]));

export const configs: Config[] = [
  {
    id: "i1",
    label: "Monocilíndrico",
    layout: "inline",
    cylinders: 1,
    order: inl([1]),
    note: "Moto, quadriciclo, cortador",
  },
  {
    id: "i2-360",
    label: "2 em linha 360°",
    layout: "inline",
    cylinders: 2,
    order: inl([1, 2]),
    note: "Twin paralelo clássico",
  },
  {
    id: "i2-270",
    label: "2 em linha 270°",
    layout: "inline",
    cylinders: 2,
    order: inl([1, 2]),
    angles: [0, 270],
    note: "Soa como um V-twin 90°",
  },
  {
    id: "i3",
    label: "3 em linha",
    layout: "inline",
    cylinders: 3,
    order: inl([1, 3, 2]),
    note: "Ronco irregular característico",
  },
  {
    id: "i4",
    label: "4 em linha",
    layout: "inline",
    cylinders: 4,
    order: inl([1, 3, 4, 2]),
    note: "O mais comum",
  },
  {
    id: "i5",
    label: "5 em linha",
    layout: "inline",
    cylinders: 5,
    order: inl([1, 2, 4, 5, 3]),
    note: "Som de Audi de rali",
  },
  {
    id: "i6",
    label: "6 em linha",
    layout: "inline",
    cylinders: 6,
    order: inl([1, 5, 3, 6, 2, 4]),
    note: "Suave e liso",
  },
  {
    id: "i8",
    label: "8 em linha",
    layout: "inline",
    cylinders: 8,
    order: inl([1, 6, 2, 5, 8, 3, 7, 4]),
    note: "Straight-8 dos anos 30",
  },
  {
    id: "v2",
    label: "V2 (V-twin)",
    layout: "v",
    cylinders: 2,
    vAngle: 45,
    order: [
      [0, 0],
      [1, 0],
    ],
    angles: [0, 315],
    note: "Pino comum: o intervalo depende do ângulo do V",
  },
  {
    id: "v6-60",
    label: "V6 60°",
    layout: "v",
    cylinders: 6,
    vAngle: 60,
    order: gm([1, 2, 3, 4, 5, 6]),
    note: "Disparo regular a cada 120°",
  },
  {
    id: "v6-90-odd",
    label: "V6 90° (odd-fire)",
    layout: "v",
    cylinders: 6,
    vAngle: 90,
    order: gm([1, 6, 5, 4, 3, 2]),
    angles: [0, 90, 240, 330, 480, 570],
    note: "Intervalos 90/150: ronco desigual",
  },
  {
    id: "v8-cross",
    label: "V8 cross-plane",
    layout: "v",
    cylinders: 8,
    vAngle: 90,
    order: gm([1, 8, 7, 2, 6, 5, 4, 3]),
    note: "O ronco 'muscle car'",
  },
  {
    id: "v8-flat",
    label: "V8 flat-plane",
    layout: "v",
    cylinders: 8,
    vAngle: 90,
    order: split(8, [1, 5, 3, 7, 4, 8, 2, 6]),
    note: "Grito de Ferrari",
  },
  {
    id: "v10",
    label: "V10",
    layout: "v",
    cylinders: 10,
    vAngle: 72,
    order: gm([1, 2, 3, 4, 7, 8, 9, 10, 5, 6]),
    note: "LFA, Carrera GT, F1 dos anos 2000",
  },
  {
    id: "v12",
    label: "V12",
    layout: "v",
    cylinders: 12,
    vAngle: 60,
    order: split(12, [1, 12, 5, 8, 3, 10, 6, 7, 2, 11, 4, 9]),
    note: "Suavidade máxima",
  },
  {
    id: "b2",
    label: "Boxer 2",
    layout: "boxer",
    cylinders: 2,
    order: [
      [0, 0],
      [1, 0],
    ],
    angles: [0, 360],
    note: "Estilo BMW R / Fusca de 2 cilindros",
  },
  {
    id: "b4",
    label: "Boxer 4",
    layout: "boxer",
    cylinders: 4,
    order: split(4, [1, 2, 3, 4]),
    note: "Subaru, Fusca, Porsche 718",
  },
  {
    id: "b6",
    label: "Boxer 6",
    layout: "boxer",
    cylinders: 6,
    order: split(6, [1, 6, 2, 4, 3, 5]),
    note: "Porsche 911",
  },
];

export type VehicleKind = "moto" | "compacto" | "esportivo" | "picape";

export const vehicles: Record<
  VehicleKind,
  { label: string; spec: EngineSpec["vehicle"]; gears: number[] }
> = {
  moto: {
    label: "Moto",
    spec: {
      massKg: 280,
      dragCoefficient: 0.6,
      crossSectionAreaM2: 0.7,
      diffRatio: 2.8,
      tireRadiusMm: 310,
      rollingResistanceN: 60,
    },
    gears: [2.6, 1.9, 1.5, 1.25, 1.1, 1.0],
  },
  compacto: {
    label: "Compacto",
    spec: {
      massKg: 1100,
      dragCoefficient: 0.32,
      crossSectionAreaM2: 2.0,
      diffRatio: 4.1,
      tireRadiusMm: 290,
      rollingResistanceN: 160,
    },
    gears: [3.55, 1.95, 1.3, 0.97, 0.78],
  },
  esportivo: {
    label: "Esportivo",
    spec: {
      massKg: 1450,
      dragCoefficient: 0.3,
      crossSectionAreaM2: 2.1,
      diffRatio: 3.42,
      tireRadiusMm: 330,
      rollingResistanceN: 200,
    },
    gears: [3.23, 2.19, 1.61, 1.23, 0.97, 0.8],
  },
  picape: {
    label: "Picape",
    spec: {
      massKg: 2400,
      dragCoefficient: 0.45,
      crossSectionAreaM2: 3.2,
      diffRatio: 3.73,
      tireRadiusMm: 400,
      rollingResistanceN: 400,
    },
    gears: [4.03, 2.36, 1.53, 1.15, 0.85, 0.67],
  },
};

export type GeneratorParams = {
  name: string;
  configId: string;
  vAngle: number;
  boreMm: number;
  strokeMm: number;
  rodRatio: number;
  compressionRatio: number;
  redlineRpm: number;
  camDurationDeg: number;
  camLiftMm: number;
  lobeSeparationDeg: number;
  flywheelKg: number;
  exhaust: "single" | "per-bank";
  header: "equal" | "unequal";
  exhaustLengthM: number;
  impulseResponse: string;
  idle: number;
  vehicle: VehicleKind;
};

export const defaultParams: GeneratorParams = {
  name: "Meu motor",
  configId: "i4",
  vAngle: 90,
  boreMm: 86,
  strokeMm: 86,
  rodRatio: 1.65,
  compressionRatio: 10.5,
  redlineRpm: 7000,
  camDurationDeg: 225,
  camLiftMm: 10,
  lobeSeparationDeg: 112,
  flywheelKg: 8,
  exhaust: "per-bank",
  header: "equal",
  exhaustLengthM: 2.5,
  impulseResponse: "mild-exhaust",
  idle: 0.5,
  vehicle: "esportivo",
};

export function configOf(id: string): Config {
  return configs.find((c) => c.id === id) ?? configs[4];
}

/** Firing order using bank-major numbering (bank 0 = cylinders 1..n/2). */
export function firingOrderText(config: Config): string {
  const perBank = config.layout === "inline" ? config.cylinders : config.cylinders / 2;
  return config.order.map(([b, pos]) => b * perBank + pos + 1).join("-");
}

export function displacementCc(p: GeneratorParams) {
  return configOf(p.configId).cylinders * (Math.PI / 4) * (p.boreMm / 10) ** 2 * (p.strokeMm / 10);
}

export function generateEngine(p: GeneratorParams): EngineSpec {
  const config = configOf(p.configId);
  const n = config.cylinders;
  const vAngle = config.layout === "v" ? p.vAngle : 0;
  const bankAngles =
    config.layout === "inline"
      ? [0]
      : config.layout === "boxer"
        ? [90, -90]
        : [-vAngle / 2, vAngle / 2];

  // Uneven V-twin interval follows the V angle (common crank pin).
  let angles = config.angles ?? even(n);
  if (config.id === "v2") angles = [0, 360 - vAngle];

  const displacementL = displacementCc(p) / 1000;
  const perCylL = displacementL / n;
  const scale = p.boreMm / 86;
  const rodLength = p.strokeMm * p.rodRatio;
  const compressionHeight = Math.max(20, p.boreMm * 0.38);
  const sweptCc = (Math.PI / 4) * (p.boreMm / 10) ** 2 * (p.strokeMm / 10);
  const chamberCc = sweptCc / (p.compressionRatio - 1);

  const perBank = config.layout === "inline" ? n : n / 2;
  const banks: BankDef[] = bankAngles.map((angleDeg, b) => ({
    angleDeg,
    flipDisplay: b === 1,
    cylinders: [] as CylinderDef[],
  }));

  const firing = new Map<string, number>();
  config.order.forEach(([b, pos], k) => {
    firing.set(`${b}:${pos}`, angles[k]);
  });

  const journals: number[] = [];
  const twoExhausts = p.exhaust === "per-bank" && banks.length > 1;
  for (let b = 0; b < banks.length; b++) {
    for (let pos = 0; pos < perBank; pos++) {
      const firingDeg = firing.get(`${b}:${pos}`) ?? 0;
      const delta = bankAngles[b] - bankAngles[0];
      const journal = (((firingDeg + delta) % 360) + 360) % 360;
      journals.push(journal);
      const unequal = p.header === "unequal";
      banks[b].cylinders.push({
        journal: journals.length - 1,
        firingDeg,
        exhaust: twoExhausts ? b : 0,
        primaryLengthMm: unequal ? 50 + ((pos * 7 + b * 3) % 5) * 120 : 100,
        soundAttenuation: 0.9 + ((pos * 3 + b) % 4) * 0.05,
        blowbyCfm: 0.05,
      });
    }
  }

  const ir =
    builtinImpulseResponses.find((i) => i.id === p.impulseResponse) ?? builtinImpulseResponses[0];
  const exhaustCount = twoExhausts ? 2 : 1;
  const crankMass = 3 + 2.2 * n * scale ** 2;
  const intakeCfm = Math.max(80, ((displacementL * p.redlineRpm) / 2 / 28.3) * 1.25);

  const exhaust = (k: number) => ({
    outletFlowCfm: Math.max(300, intakeCfm * 1.6) / exhaustCount,
    primaryTubeLengthMm: 700,
    primaryFlowCfm: Math.max(150, (intakeCfm / n) * 4),
    velocityDecay: 1,
    collectorAreaCm2: Math.PI * (2.2 + 1.5 * Math.sqrt(displacementL / exhaustCount)) ** 2,
    lengthMm: p.exhaustLengthM * 1000 + k * 150,
    audioVolume: (0.004 / ir.defaultVolume) * (n > 4 ? 1 : 1.5),
    impulseResponse: ir.id,
    impulseVolume: ir.defaultVolume,
  });

  const spec = buildEngine({
    name: p.name || "Meu motor",
    redlineRpm: p.redlineRpm,
    revLimitRpm: p.redlineRpm + 300,
    limiterDurationS: 0.08,
    starterTorqueNm: Math.max(40, 120 * displacementL),
    starterSpeedRpm: n >= 10 ? 400 : 300,
    throttleGamma: 2,
    jitter: 0.4,
    fuel: { maxBurningEfficiency: 0.9, turbulenceToFlameSpeedRatio: fastBurn },

    boreMm: p.boreMm,
    strokeMm: p.strokeMm,
    rodLengthMm: rodLength,
    rodMassKg: 0.45 * scale ** 3,
    pistonMassKg: 0.35 * scale ** 3,
    compressionHeightMm: compressionHeight,
    crank: {
      massKg: crankMass,
      flywheelMassKg: p.flywheelKg,
      frictionTorqueNm: 2 + 1.2 * n * scale ** 2,
      momentOfInertia:
        diskMoment(crankMass, p.strokeMm) +
        diskMoment(p.flywheelKg, 140 + 25 * Math.sqrt(displacementL)) +
        diskMoment(3, 60),
      tdcDeg: 90 + bankAngles[0],
    },
    journalsDeg: journals,
    banks,
    head: {
      chamberVolumeCc: chamberCc,
      intakeRunnerVolumeCc: Math.max(60, perCylL * 300),
      intakeRunnerAreaCm2: 10 * scale ** 2,
      exhaustRunnerVolumeCc: Math.max(30, perCylL * 100),
      exhaustRunnerAreaCm2: 8 * scale ** 2,
      intakePortFlow: flowTable(atgIntakeFlow, { flowScale: scale ** 2 }),
      exhaustPortFlow: flowTable(atgExhaustFlow, { flowScale: scale ** 2 }),
    },
    cam: {
      intakeLobe: {
        type: "harmonic",
        durationAt50ThouDeg: p.camDurationDeg,
        gamma: 1.1,
        liftMm: p.camLiftMm,
        steps: 100,
      },
      exhaustLobe: {
        type: "harmonic",
        durationAt50ThouDeg: p.camDurationDeg + 4,
        gamma: 1.1,
        liftMm: p.camLiftMm * 0.97,
        steps: 100,
      },
      intakeCenterDeg: p.lobeSeparationDeg + 2,
      exhaustCenterDeg: p.lobeSeparationDeg - 2,
      baseRadiusMm: 17,
    },
    intakes: [
      {
        plenumVolumeL: Math.max(0.5, displacementL * 0.3),
        plenumAreaCm2: 20,
        intakeFlowCfm: intakeCfm,
        runnerFlowCfm: Math.max(60, (intakeCfm / n) * 1.6),
        runnerLengthMm: 250,
        idleFlowCfm: 0,
        // Smaller engines need a relatively larger idle opening.
        idleThrottlePlatePosition:
          1 - (0.0015 + 0.004 * p.idle) / Math.sqrt(Math.max(0.15, displacementL / 2)),
        velocityDecay: 0.5,
      },
    ],
    exhausts: Array.from({ length: exhaustCount }, (_, k) => exhaust(k)),
    timingCurve: timing([
      [0, 12],
      [1000, 12],
      [2000, 20],
      [3000, 28],
      [4000, 34],
      [Math.max(5000, p.redlineRpm), 36],
    ]),
    vehicle: vehicles[p.vehicle].spec,
    transmission: {
      maxClutchTorqueNm: Math.max(300, 160 * displacementL),
      gears: vehicles[p.vehicle].gears,
    },
  });

  return spec;
}
