/**
 * Evaluator for engine-sim's .mr scripts. Produces a graph of plain objects
 * mirroring the original es_script nodes (engine, cylinder banks, heads...),
 * which `toSpec` then turns into an EngineSpec.
 *
 * Evaluation model (close enough to Piranha for engine-sim scripts):
 * - every node instantiation creates a scope; inputs, outputs and locally
 *   declared instances are lazy and memoized, so forward references work;
 * - body statements run in order (side effects like add_lobe keep their order);
 * - `a.f(x)` instantiates node f with `this: a`;
 * - a node with an `alias output` evaluates to that output, otherwise to the
 *   instance itself (so `wires.wire1` / `camshaft.intake_cam_0` work).
 */

import { type Arg, type Expr, type Module, type NodeDef, parse, type Statement } from "./parser";

// ---------------------------------------------------------------------------
// Runtime objects (mirroring es_script nodes; all values in SI units)
// ---------------------------------------------------------------------------

export type MrFunction = {
  t: "function";
  filterRadius: number;
  samples: [number, number][];
  harmonic?: { durationAt50Thou: number; gamma: number; lift: number; steps: number };
};
export type MrRodJournal = {
  t: "rod_journal";
  angle: number;
  crank: MrCrankshaft | null;
  rod: MrRod | null;
};
export type MrCrankshaft = { t: "crankshaft"; p: Record<string, number>; journals: MrRodJournal[] };
export type MrRod = { t: "rod"; p: Record<string, number>; journals: MrRodJournal[] };
export type MrPiston = { t: "piston"; p: Record<string, number> };
export type MrCamshaft = {
  t: "camshaft";
  advance: number;
  baseRadius: number;
  lobe: MrFunction;
  lobes: number[];
};
export type MrValvetrain =
  | { t: "standard_valvetrain"; intake: MrCamshaft; exhaust: MrCamshaft }
  | {
      t: "vtec_valvetrain";
      intake: MrCamshaft;
      exhaust: MrCamshaft;
      vtecIntake: MrCamshaft;
      vtecExhaust: MrCamshaft;
      p: Record<string, number>;
    };
export type MrHead = {
  t: "cylinder_head";
  p: Record<string, number>;
  flip: boolean;
  intakeFlow: MrFunction;
  exhaustFlow: MrFunction;
  valvetrain: MrValvetrain;
};
export type MrIntake = { t: "intake"; p: Record<string, number> };
export type MrImpulse = { t: "impulse_response"; filename: string; volume: number };
export type MrExhaust = {
  t: "exhaust_system";
  p: Record<string, number>;
  impulse: MrImpulse | null;
};
export type MrWire = { t: "ignition_wire"; connections: { bank: MrBank; index: number }[] };
export type MrCylinder = {
  piston: MrPiston;
  rod: MrRod;
  journal: MrRodJournal;
  intake: MrIntake;
  exhaust: MrExhaust;
  soundAttenuation: number;
  primaryLength: number;
};
export type MrBank = {
  t: "cylinder_bank";
  p: Record<string, number>;
  cylinders: MrCylinder[];
  head: MrHead | null;
};
export type MrIgnition = {
  t: "ignition_module";
  timing: MrFunction;
  revLimit: number;
  limiterDuration: number;
  posts: { wire: MrWire; angle: number }[];
};
export type MrFuel = {
  t: "fuel";
  name: string;
  p: Record<string, number>;
  turbulence: MrFunction | null;
};
export type MrThrottle =
  | { t: "direct_throttle_linkage"; gamma: number }
  | { t: "governor"; p: Record<string, number> };
export type MrEngine = {
  t: "engine";
  name: string;
  p: Record<string, number>;
  fuel: MrFuel | null;
  throttle: MrThrottle | null;
  banks: MrBank[];
  crankshafts: MrCrankshaft[];
  ignition: MrIgnition | null;
};
export type MrVehicle = { t: "vehicle"; p: Record<string, number> };
export type MrTransmission = { t: "transmission"; maxClutchTorque: number; gears: number[] };

export type MrResult = {
  engine: MrEngine | null;
  vehicle: MrVehicle | null;
  transmission: MrTransmission | null;
};

type Value = number | string | boolean | null | Instance | { t: string };

// ---------------------------------------------------------------------------

export class MrRuntimeError extends Error {}

const R = 8.31446261815324;
const hcr5 = 1 + 2 / 5;

/** GasSystem::flowConstant from the core (gives the flow constant per scfm). */
export function flowConstant(scfm: number, pressureDropPa: number): number {
  const P = 101325;
  const T = 25 + 273.15;
  const hcr = hcr5;
  const pRatio = (P - pressureDropPa) / P;
  const choked = (2 / (hcr + 1)) ** (hcr / (hcr - 1));
  let rate: number;
  if (pRatio <= choked) {
    rate = Math.sqrt(hcr) * (2 / (hcr + 1)) ** ((hcr + 1) / (2 * (hcr - 1)));
  } else {
    rate =
      Math.sqrt(((2 * hcr) / (hcr - 1)) * (1 - pRatio ** ((hcr - 1) / hcr))) * pRatio ** (1 / hcr);
  }
  rate *= P / Math.sqrt(R * T);
  const lbmol = 453.59237;
  const scfmUnit = (0.002641 * lbmol) / 60;
  return (scfm * scfmUnit) / rate;
}
const inHg = 3386.3886666666713;
export const kCarb = (cfm: number) => flowConstant(cfm, 1.5 * inHg);
export const k28inH2O = (cfm: number) => flowConstant(cfm, 28 * inHg * 0.0734824);

// ---------------------------------------------------------------------------

type Thunk = {
  expr: Expr | null;
  scope: Scope;
  value?: Value;
  forcing?: boolean;
  make?: () => Value;
};

class Scope {
  vars = new Map<string, Thunk>();
  constructor(readonly parent: Scope | null) {}
  lookup(name: string): Thunk | undefined {
    return this.vars.get(name) ?? this.parent?.lookup(name);
  }
}

class Instance {
  outputs = new Map<string, Thunk>();
  aliasValue?: Thunk;
  constructor(
    readonly def: NodeDef,
    readonly scope: Scope,
  ) {}
}

type Builtin = (inputs: Record<string, Value>, interp: Interpreter) => Value;

const asNumber = (v: Value, what: string): number => {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  throw new MrRuntimeError(`${what}: esperado número, veio ${describe(v)}`);
};
const asObj = <T extends { t: string }>(v: Value, t: string, what: string): T => {
  if (v && typeof v === "object" && "t" in v && v.t === t) return v as T;
  throw new MrRuntimeError(`${what}: esperado ${t}, veio ${describe(v)}`);
};
const describe = (v: Value) =>
  v instanceof Instance
    ? `nó ${v.def.name}`
    : v && typeof v === "object"
      ? (v as { t: string }).t
      : String(v);

const nums = (inputs: Record<string, Value>, names: string[]) =>
  Object.fromEntries(
    names.map((n) => [n, typeof inputs[n] === "number" ? (inputs[n] as number) : 0]),
  );

const builtins: Record<string, Builtin> = {
  __engine_sim__function: (i) => ({
    t: "function",
    filterRadius: asNumber(i.filter_radius ?? 1, "function"),
    samples: [],
  }),
  __engine_sim__engine: (i) => ({
    t: "engine",
    name: String(i.name ?? "Motor"),
    p: nums(i, [
      "redline",
      "starter_speed",
      "starter_torque",
      "dyno_min_speed",
      "dyno_max_speed",
      "dyno_hold_step",
      "simulation_frequency",
      "hf_gain",
      "jitter",
      "noise",
    ]),
    fuel: (i.fuel as MrFuel) ?? null,
    throttle: (i.throttle as MrThrottle) ?? null,
    banks: [],
    crankshafts: [],
    ignition: null,
  }),
  __engine_sim__direct_throttle_linkage: (i) => ({
    t: "direct_throttle_linkage",
    gamma: asNumber(i.gamma ?? 1, "gamma"),
  }),
  __engine_sim__governor: (i) => ({
    t: "governor",
    p: nums(i, ["min_speed", "max_speed", "min_v", "max_v", "k_s", "k_d", "gamma"]),
  }),
  __engine_sim__crankshaft: (i) => ({
    t: "crankshaft",
    p: nums(i, [
      "throw",
      "flywheel_mass",
      "mass",
      "friction_torque",
      "moment_of_inertia",
      "position_x",
      "position_y",
      "tdc",
    ]),
    journals: [],
  }),
  __engine_sim__rod_journal: (i) => ({
    t: "rod_journal",
    angle: asNumber(i.angle ?? 0, "rod_journal"),
    crank: null,
    rod: null,
  }),
  __engine_sim__connecting_rod: (i) => ({
    t: "rod",
    p: nums(i, ["mass", "moment_of_inertia", "center_of_mass", "length", "slave_throw"]),
    journals: [],
  }),
  __engine_sim__piston: (i) => ({
    t: "piston",
    p: nums(i, ["mass", "blowby", "compression_height", "wrist_pin_position", "displacement"]),
  }),
  __engine_sim__cylinder_bank: (i) => ({
    t: "cylinder_bank",
    p: nums(i, ["angle", "bore", "deck_height", "position_x", "position_y", "display_depth"]),
    cylinders: [],
    head: null,
  }),
  __engine_sim__cylinder_head: (i) => ({
    t: "cylinder_head",
    p: nums(i, [
      "chamber_volume",
      "intake_runner_volume",
      "intake_runner_cross_section_area",
      "exhaust_runner_volume",
      "exhaust_runner_cross_section_area",
    ]),
    flip: Boolean(i.flip_display),
    intakeFlow: asObj<MrFunction>(i.intake_port_flow, "function", "intake_port_flow"),
    exhaustFlow: asObj<MrFunction>(i.exhaust_port_flow, "function", "exhaust_port_flow"),
    valvetrain: i.valvetrain as MrValvetrain,
  }),
  __engine_sim__camshaft: (i) => ({
    t: "camshaft",
    advance: asNumber(i.advance ?? 0, "advance"),
    baseRadius: asNumber(i.base_radius ?? 0, "base_radius"),
    lobe: asObj<MrFunction>(i.lobe_profile, "function", "lobe_profile"),
    lobes: [],
  }),
  __engine_sim__standard_valvetrain: (i) => ({
    t: "standard_valvetrain",
    intake: asObj<MrCamshaft>(i.intake_camshaft, "camshaft", "intake_camshaft"),
    exhaust: asObj<MrCamshaft>(i.exhaust_camshaft, "camshaft", "exhaust_camshaft"),
  }),
  __engine_sim__vtec_valvetrain: (i) => ({
    t: "vtec_valvetrain",
    intake: asObj<MrCamshaft>(i.intake_camshaft, "camshaft", "intake_camshaft"),
    exhaust: asObj<MrCamshaft>(i.exhaust_camshaft, "camshaft", "exhaust_camshaft"),
    vtecIntake: asObj<MrCamshaft>(i.vtec_intake_camshaft, "camshaft", "vtec_intake_camshaft"),
    vtecExhaust: asObj<MrCamshaft>(i.vtec_exhaust_camshaft, "camshaft", "vtec_exhaust_camshaft"),
    p: nums(i, ["min_rpm", "min_speed", "manifold_vacuum", "min_throttle_position"]),
  }),
  __engine_sim__intake: (i) => ({
    t: "intake",
    p: nums(i, [
      "plenum_volume",
      "plenum_cross_section_area",
      "intake_flow_rate",
      "idle_flow_rate",
      "runner_flow_rate",
      "molecular_afr",
      "idle_throttle_plate_position",
      "runner_length",
      "velocity_decay",
    ]),
  }),
  __engine_sim__impulse_response: (i) => ({
    t: "impulse_response",
    filename: String(i.filename ?? ""),
    volume: asNumber(i.volume ?? 1, "volume"),
  }),
  __engine_sim__exhaust_system: (i) => ({
    t: "exhaust_system",
    p: nums(i, [
      "length",
      "collector_cross_section_area",
      "outlet_flow_rate",
      "primary_tube_length",
      "primary_flow_rate",
      "audio_volume",
      "velocity_decay",
    ]),
    impulse: (i.impulse_response as MrImpulse) ?? null,
  }),
  __engine_sim__ignition_module: (i) => ({
    t: "ignition_module",
    timing: asObj<MrFunction>(i.timing_curve, "function", "timing_curve"),
    revLimit: asNumber(i.rev_limit ?? 0, "rev_limit"),
    limiterDuration: asNumber(i.limiter_duration ?? 0.5, "limiter_duration"),
    posts: [],
  }),
  __engine_sim__ignition_wire: () => ({ t: "ignition_wire", connections: [] }),
  __engine_sim__fuel: (i) => ({
    t: "fuel",
    name: String(i.name ?? "Gasoline"),
    p: nums(i, [
      "molecular_mass",
      "energy_density",
      "density",
      "molecular_afr",
      "max_burning_efficiency",
      "burning_efficiency_randomness",
      "low_efficiency_attenuation",
      "max_turbulence_effect",
      "max_dilution_effect",
    ]),
    turbulence: (i.turbulence_to_flame_speed_ratio as MrFunction) ?? null,
  }),
  __engine_sim__vehicle: (i) => ({
    t: "vehicle",
    p: nums(i, [
      "mass",
      "drag_coefficient",
      "cross_sectional_area",
      "diff_ratio",
      "tire_radius",
      "rolling_resistance",
    ]),
  }),
  __engine_sim__transmission: (i) => ({
    t: "transmission",
    maxClutchTorque: asNumber(i.max_clutch_torque ?? 0, "max_clutch_torque"),
    gears: [],
  }),

  // ---- actions -----------------------------------------------------------
  __engine_sim__set_engine: (i, it) => {
    it.result.engine = asObj<MrEngine>(i.engine, "engine", "set_engine");
    return null;
  },
  __engine_sim__set_vehicle: (i, it) => {
    it.result.vehicle = asObj<MrVehicle>(i.vehicle, "vehicle", "set_vehicle");
    return null;
  },
  __engine_sim__set_transmission: (i, it) => {
    it.result.transmission = asObj<MrTransmission>(
      i.transmission,
      "transmission",
      "set_transmission",
    );
    return null;
  },
  __engine_sim__set_application_settings: () => null,
  __engine_sim__add_rod_journal: (i) => {
    const j = asObj<MrRodJournal>(i.rod_journal, "rod_journal", "add_rod_journal");
    const c = asObj<MrCrankshaft>(i.crankshaft, "crankshaft", "add_rod_journal");
    c.journals.push(j);
    j.crank = c;
    return null;
  },
  __engine_sim__add_slave_journal: (i) => {
    const j = asObj<MrRodJournal>(i.rod_journal, "rod_journal", "add_slave_journal");
    const r = asObj<MrRod>(i.rod, "rod", "add_slave_journal");
    r.journals.push(j);
    j.rod = r;
    return null;
  },
  __engine_sim__add_crankshaft: (i) => {
    asObj<MrEngine>(i.engine, "engine", "add_crankshaft").crankshafts.push(
      asObj<MrCrankshaft>(i.crankshaft, "crankshaft", "add_crankshaft"),
    );
    return null;
  },
  __engine_sim__add_cylinder_bank: (i) => {
    asObj<MrEngine>(i.engine, "engine", "add_cylinder_bank").banks.push(
      asObj<MrBank>(i.cylinder_bank, "cylinder_bank", "add_cylinder_bank"),
    );
    return null;
  },
  __engine_sim__add_cylinder: (i) => {
    const bank = asObj<MrBank>(i.cylinder_bank, "cylinder_bank", "add_cylinder");
    bank.cylinders.push({
      piston: asObj<MrPiston>(i.piston, "piston", "add_cylinder.piston"),
      rod: asObj<MrRod>(i.connecting_rod, "rod", "add_cylinder.connecting_rod"),
      journal: asObj<MrRodJournal>(i.rod_journal, "rod_journal", "add_cylinder.rod_journal"),
      intake: asObj<MrIntake>(i.intake, "intake", "add_cylinder.intake"),
      exhaust: asObj<MrExhaust>(i.exhaust_system, "exhaust_system", "add_cylinder.exhaust_system"),
      soundAttenuation: asNumber(i.sound_attenuation ?? 1, "sound_attenuation"),
      primaryLength: asNumber(i.primary_length ?? 0, "primary_length"),
    });
    asObj<MrWire>(i.ignition_wire, "ignition_wire", "add_cylinder.ignition_wire").connections.push({
      bank,
      index: bank.cylinders.length - 1,
    });
    return null;
  },
  __engine_sim__add_sample: (i) => {
    asObj<MrFunction>(i.function, "function", "add_sample").samples.push([
      asNumber(i.x, "add_sample.x"),
      asNumber(i.y, "add_sample.y"),
    ]);
    return null;
  },
  __engine_sim__add_lobe: (i) => {
    asObj<MrCamshaft>(i.camshaft, "camshaft", "add_lobe").lobes.push(
      asNumber(i.centerline, "centerline"),
    );
    return null;
  },
  __engine_sim__set_cylinder_head: (i) => {
    asObj<MrBank>(i.bank, "cylinder_bank", "set_cylinder_head").head = asObj<MrHead>(
      i.head,
      "cylinder_head",
      "set_cylinder_head",
    );
    return null;
  },
  __engine_sim__k_28inH2O: (i) => k28inH2O(asNumber(i.flow ?? 1, "k_28inH2O")),
  __engine_sim__k_carb: (i) => kCarb(asNumber(i.flow ?? 1, "k_carb")),
  __engine_sim__connect_ignition_wire: (i) => {
    asObj<MrIgnition>(i.ignition_module, "ignition_module", "connect_wire").posts.push({
      wire: asObj<MrWire>(i.wire, "ignition_wire", "connect_wire"),
      angle: asNumber(i.angle, "connect_wire.angle"),
    });
    return null;
  },
  __engine_sim__add_ignition_module: (i) => {
    asObj<MrEngine>(i.engine, "engine", "add_ignition_module").ignition = asObj<MrIgnition>(
      i.ignition_module,
      "ignition_module",
      "add_ignition_module",
    );
    return null;
  },
  __engine_sim__generate_harmonic_cam_lobe: (i) => {
    const f = asObj<MrFunction>(i.function, "function", "harmonic_cam_lobe");
    f.harmonic = {
      durationAt50Thou: asNumber(i.duration_at_50_thou, "duration_at_50_thou"),
      gamma: asNumber(i.gamma ?? 1, "gamma"),
      lift: asNumber(i.lift, "lift"),
      steps: Math.round(asNumber(i.steps ?? 100, "steps")),
    };
    return null;
  },
  __engine_sim__add_gear: (i) => {
    asObj<MrTransmission>(i.transmission, "transmission", "add_gear").gears.push(
      asNumber(i.ratio, "ratio"),
    );
    return null;
  },
};

// ---------------------------------------------------------------------------

export class Interpreter {
  readonly defs = new Map<string, NodeDef>();
  readonly global = new Scope(null);
  readonly result: MrResult = { engine: null, vehicle: null, transmission: null };
  private loaded = new Set<string>();
  private depth = 0;

  constructor(private readonly readFile: (path: string) => string | null) {}

  /** Loads a file (and its imports) and runs its top-level statements. */
  run(path: string) {
    const modules: Module[] = [];
    this.collect(path, modules);
    // Register every definition before running anything: files reference
    // nodes from modules that are imported later in the chain.
    for (const module of modules) for (const def of module.nodes) this.defs.set(def.name, def);
    for (const module of modules) this.execBody(module.statements, this.global);
    if (!this.result.engine && this.defs.has("main"))
      this.instantiate("main", [], null, this.global);
    if (!this.result.engine) this.findEngineNode(path);
  }

  /**
   * Library-style files only define `public node my_engine { ... }` without a
   * main(). Try the file's argument-free nodes (last first) and keep the
   * first one that evaluates to an engine.
   */
  private findEngineNode(path: string) {
    const candidates = [...this.defs.values()]
      .filter((d) => d.file === path && !d.builtin && d.name !== "main")
      .filter((d) => d.ports.every((p) => p.kind !== "input" || p.value !== null))
      .reverse();
    for (const def of candidates) {
      try {
        const value = this.instantiate(def.name, [], null, this.global);
        if (value && typeof value === "object" && "t" in value && value.t === "engine") {
          this.result.engine = value as MrEngine;
          return;
        }
      } catch {
        // not an engine node; keep looking
      }
    }
  }

  private collect(path: string, out: Module[]) {
    if (this.loaded.has(path)) return;
    this.loaded.add(path);
    const source = this.readFile(path);
    if (source === null) throw new MrRuntimeError(`arquivo não encontrado: ${path}`);
    const module = parse(source, path);
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
    for (const imp of module.imports) {
      // Relative to the importing file, then the es/ library root.
      const candidates = [normalize(dir + imp), normalize(`es/${imp}`), normalize(imp)];
      const found = candidates.find((c) => this.loaded.has(c) || this.readFile(c) !== null);
      if (!found) throw new MrRuntimeError(`${path}: import não encontrado "${imp}"`);
      this.collect(found, out);
    }
    out.push(module);
  }

  private declare(statements: Statement[], scope: Scope) {
    for (const s of statements) {
      if (s.kind === "instance") {
        const thunk: Thunk = {
          expr: null,
          scope,
          make: () => this.instantiate(s.type, s.args, null, scope),
        };
        scope.vars.set(s.name, thunk);
      }
    }
  }

  private execBody(statements: Statement[], scope: Scope) {
    this.declare(statements, scope);
    for (const s of statements) {
      if (s.kind === "instance") {
        const thunk = scope.vars.get(s.name);
        if (thunk) this.force(thunk, s.name);
      } else {
        this.eval(s.expr, scope);
      }
    }
  }

  private force(thunk: Thunk, name: string): Value {
    if ("value" in thunk) return thunk.value as Value;
    if (thunk.forcing) throw new MrRuntimeError(`referência circular em '${name}'`);
    thunk.forcing = true;
    const value = thunk.make
      ? thunk.make()
      : thunk.expr
        ? this.eval(thunk.expr, thunk.scope)
        : null;
    thunk.forcing = false;
    thunk.value = value;
    return value;
  }

  instantiate(
    type: string,
    args: Arg[],
    self: Value | undefined | null,
    callerScope: Scope,
  ): Value {
    const def = this.defs.get(type);
    if (!def) throw new MrRuntimeError(`nó desconhecido: ${type}`);
    if (++this.depth > 400) throw new MrRuntimeError("recursão profunda demais");

    try {
      const scope = new Scope(this.global);
      const instance = new Instance(def, scope);
      const inputs = def.ports.filter((p) => p.kind === "input");
      const bound = new Set<string>();

      if (self !== null && self !== undefined) {
        scope.vars.set("this", { expr: null, scope, value: self });
        bound.add("this");
      }

      // Named args first, then positional args fill remaining inputs in order.
      for (const arg of args) {
        if (arg.name === null) continue;
        if (!inputs.some((p) => p.name === arg.name)) {
          throw new MrRuntimeError(`${type}: entrada desconhecida '${arg.name}'`);
        }
        scope.vars.set(arg.name, { expr: arg.value, scope: callerScope });
        bound.add(arg.name);
      }
      let cursor = 0;
      for (const arg of args) {
        if (arg.name !== null) continue;
        while (cursor < inputs.length && bound.has(inputs[cursor].name)) cursor++;
        if (cursor >= inputs.length) throw new MrRuntimeError(`${type}: argumentos demais`);
        scope.vars.set(inputs[cursor].name, { expr: arg.value, scope: callerScope });
        bound.add(inputs[cursor].name);
      }
      for (const input of inputs) {
        if (!bound.has(input.name)) scope.vars.set(input.name, { expr: input.value, scope });
      }

      for (const port of def.ports) {
        if (port.kind === "output") {
          const t: Thunk = { expr: port.value, scope };
          instance.outputs.set(port.name, t);
          // Outputs are also visible by name inside the node body.
          if (!scope.vars.has(port.name)) scope.vars.set(port.name, t);
        }
      }

      if (def.builtin) {
        const fn = builtins[def.builtin];
        if (!fn) throw new MrRuntimeError(`função nativa não suportada: ${def.builtin}`);
        const values: Record<string, Value> = {};
        for (const input of inputs) {
          const thunk = scope.vars.get(input.name);
          if (thunk && (thunk.expr || "value" in thunk))
            values[input.name] = this.force(thunk, input.name);
        }
        if (self !== null && self !== undefined) values.this = self;
        const value = fn(values, this);
        this.execBody(def.body, scope);
        return value;
      }

      this.execBody(def.body, scope);

      const alias = def.ports.find((p) => p.kind === "alias");
      if (alias) {
        if (!alias.value) return null;
        return this.eval(alias.value, scope);
      }
      return instance;
    } finally {
      this.depth--;
    }
  }

  private eval(e: Expr, scope: Scope): Value {
    switch (e.kind) {
      case "num":
        return e.value;
      case "str":
        return e.value;
      case "bool":
        return e.value;
      case "name": {
        const thunk = scope.lookup(e.name);
        if (!thunk) throw new MrRuntimeError(`linha ${e.line}: nome desconhecido '${e.name}'`);
        return this.force(thunk, e.name);
      }
      case "unary":
        return -asNumber(this.eval(e.arg, scope), "negação");
      case "binary": {
        const a = this.eval(e.left, scope);
        const b = this.eval(e.right, scope);
        if (e.op === "+" && (typeof a === "string" || typeof b === "string")) return `${a}${b}`;
        const x = asNumber(a, `operador ${e.op}`);
        const y = asNumber(b, `operador ${e.op}`);
        switch (e.op) {
          case "+":
            return x + y;
          case "-":
            return x - y;
          case "*":
            return x * y;
          case "/":
            return x / y;
        }
        return null;
      }
      case "member": {
        const object = this.eval(e.object, scope);
        if (!(object instanceof Instance)) {
          throw new MrRuntimeError(`linha ${e.line}: '${e.name}' acessado em ${describe(object)}`);
        }
        const thunk = object.outputs.get(e.name) ?? object.scope.vars.get(e.name);
        if (!thunk)
          throw new MrRuntimeError(`linha ${e.line}: ${object.def.name} não tem '${e.name}'`);
        return this.force(thunk, e.name);
      }
      case "call": {
        const self = e.self ? this.eval(e.self, scope) : null;
        try {
          return this.instantiate(e.callee, e.args, self, scope);
        } catch (error) {
          if (error instanceof MrRuntimeError && !error.message.startsWith("linha")) {
            throw new MrRuntimeError(`linha ${e.line}: ${error.message}`);
          }
          throw error;
        }
      }
    }
  }
}

function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "." && part !== "") parts.push(part);
  }
  return parts.join("/");
}
