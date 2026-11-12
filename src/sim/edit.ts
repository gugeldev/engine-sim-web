import type { CamSpec, EngineSpec, HarmonicLobe } from "./spec";

/**
 * High-level knobs over an EngineSpec. Each setter applies the change to every
 * bank/cylinder so the editor can expose simple values ("bore") instead of the
 * full object graph. Setters return a new spec.
 */

const first = (spec: EngineSpec) => spec.banks[0];
const firstCyl = (spec: EngineSpec) => spec.banks[0].cylinders[0];

export const get = {
  bore: (s: EngineSpec) => first(s).boreMm,
  stroke: (s: EngineSpec) => s.crankshafts[0].throwMm * 2,
  rodLength: (s: EngineSpec) => firstCyl(s).rod.lengthMm,
  chamberVolume: (s: EngineSpec) => first(s).head.chamberVolumeCc,
  cylinders: (s: EngineSpec) => s.banks.reduce((n, b) => n + b.cylinders.length, 0),
  displacementCc: (s: EngineSpec) =>
    s.banks.reduce(
      (total, b) =>
        total +
        b.cylinders.length *
          (Math.PI / 4) *
          (b.boreMm / 10) ** 2 *
          ((s.crankshafts[0].throwMm * 2) / 10),
      0,
    ),
  compressionRatio: (s: EngineSpec) => {
    const swept = (Math.PI / 4) * (get.bore(s) / 10) ** 2 * (get.stroke(s) / 10);
    const chamber = get.chamberVolume(s);
    return (swept + chamber) / chamber;
  },
  cam: (s: EngineSpec, which: "intakeCam" | "exhaustCam"): CamSpec =>
    first(s).head.valvetrain[which],
  maxTiming: (s: EngineSpec) =>
    s.ignition.timingCurve.samples.reduce((m, [, v]) => Math.max(m, v), 0),
};

const mapBanks = (
  spec: EngineSpec,
  fn: (bank: EngineSpec["banks"][number]) => EngineSpec["banks"][number],
) => ({
  ...spec,
  banks: spec.banks.map(fn),
});

const mapCylinders = (
  spec: EngineSpec,
  fn: (
    cyl: EngineSpec["banks"][number]["cylinders"][number],
  ) => EngineSpec["banks"][number]["cylinders"][number],
) => mapBanks(spec, (b) => ({ ...b, cylinders: b.cylinders.map(fn) }));

/** Deck clearance (piston crown to deck at TDC) is preserved when geometry changes. */
function withDeck(spec: EngineSpec, next: EngineSpec): EngineSpec {
  return mapBanks(next, (bank) => {
    const index = next.banks.indexOf(bank);
    const prevBank = spec.banks[index];
    const prevCyl = prevBank.cylinders[0];
    const cyl = bank.cylinders[0];
    const clearance =
      prevBank.deckHeightMm -
      (spec.crankshafts[0].throwMm + prevCyl.rod.lengthMm + prevCyl.piston.compressionHeightMm);
    return {
      ...bank,
      deckHeightMm:
        next.crankshafts[0].throwMm + cyl.rod.lengthMm + cyl.piston.compressionHeightMm + clearance,
    };
  });
}

export const set = {
  bore: (s: EngineSpec, mm: number) => mapBanks(s, (b) => ({ ...b, boreMm: mm })),
  stroke: (s: EngineSpec, mm: number) =>
    withDeck(s, { ...s, crankshafts: s.crankshafts.map((c) => ({ ...c, throwMm: mm / 2 })) }),
  rodLength: (s: EngineSpec, mm: number) =>
    withDeck(
      s,
      mapCylinders(s, (c) => ({
        ...c,
        rod: {
          ...c.rod,
          lengthMm: mm,
          momentOfInertia: (1 / 12) * c.rod.massKg * (mm / 1000) ** 2,
        },
      })),
    ),
  chamberVolume: (s: EngineSpec, cc: number) =>
    mapBanks(s, (b) => ({ ...b, head: { ...b.head, chamberVolumeCc: cc } })),
  compressionRatio: (s: EngineSpec, ratio: number) => {
    const swept = (Math.PI / 4) * (get.bore(s) / 10) ** 2 * (get.stroke(s) / 10);
    return set.chamberVolume(s, swept / (Math.max(1.5, ratio) - 1));
  },
  /** Moves every lobe of a cam so its lobe center changes by `deltaDeg` (crank degrees). */
  camCenterDelta: (s: EngineSpec, which: "intakeCam" | "exhaustCam", deltaDeg: number) =>
    mapBanks(s, (b) => {
      const vt = b.head.valvetrain;
      const sign = which === "intakeCam" ? 1 : -1;
      const shift = (cam: CamSpec): CamSpec => ({
        ...cam,
        lobesDeg: cam.lobesDeg.map((l) => l + sign * deltaDeg),
      });
      return { ...b, head: { ...b.head, valvetrain: { ...vt, [which]: shift(vt[which]) } } };
    }),
  cam: (
    s: EngineSpec,
    which: "intakeCam" | "exhaustCam",
    patch: Omit<Partial<CamSpec>, "lobe"> & { lobe?: Partial<HarmonicLobe> },
  ) =>
    mapBanks(s, (b) => {
      const vt = b.head.valvetrain;
      const cam = vt[which];
      const lobe = patch.lobe ? ({ ...cam.lobe, ...patch.lobe } as CamSpec["lobe"]) : cam.lobe;
      return {
        ...b,
        head: { ...b.head, valvetrain: { ...vt, [which]: { ...cam, ...patch, lobe } } },
      };
    }),
  timingOffset: (s: EngineSpec, deltaDeg: number) => ({
    ...s,
    ignition: {
      ...s.ignition,
      timingCurve: {
        ...s.ignition.timingCurve,
        samples: s.ignition.timingCurve.samples.map(
          ([rpm, adv]) => [rpm, adv + deltaDeg] as [number, number],
        ),
      },
    },
  }),
  intake: (s: EngineSpec, patch: Partial<EngineSpec["intakes"][number]>) => ({
    ...s,
    intakes: s.intakes.map((i) => ({ ...i, ...patch })),
  }),
  pistonMass: (s: EngineSpec, kg: number) =>
    mapCylinders(s, (c) => ({ ...c, piston: { ...c.piston, massKg: kg } })),
  inertiaScale: (s: EngineSpec, factor: number) => ({
    ...s,
    crankshafts: s.crankshafts.map((c) => ({ ...c, momentOfInertia: c.momentOfInertia * factor })),
  }),
};
