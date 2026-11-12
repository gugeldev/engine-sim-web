/**
 * Interprets every engine script in src/mr/library/engines and runs a short
 * start/idle/full-throttle test on each.   bun scripts/check-mr.ts [filter]
 */
import { readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import createEngineSim from "../src/sim/wasm/engine-sim.js";
import { specFromLibraryFile } from "./mr-node";

const root = resolve(import.meta.dir, "../src/mr/library");
const filter = process.argv[2] ?? "";
const files: string[] = [];
const walk = (dir: string) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".mr") && !p.endsWith("radial.mr")) files.push(relative(root, p));
  }
};
walk(join(root, "engines"));

for (const file of files.sort().filter((f) => f.includes(filter))) {
  let spec: ReturnType<typeof specFromLibraryFile>;
  try {
    spec = specFromLibraryFile(file);
  } catch (e) {
    console.log(`✗ ${file}: ${(e as Error).message}`);
    continue;
  }
  const mod = await createEngineSim({
    locateFile: (f: string) => resolve(import.meta.dir, "../src/sim/wasm", f),
  });
  mod.load(spec, 44100);
  const step = (s: number) => {
    for (let i = 0; i < Math.round((s * 44100) / 512); i++) mod.process(512, 512 / 44100);
    return mod.getState().rpm;
  };
  const t0 = performance.now();
  mod.setIgnition(true);
  mod.setStarter(true);
  step(4);
  mod.setStarter(false);
  const idle = step(1.5);
  mod.setThrottle(1);
  const wot = step(1.5);
  const rt = 7 / ((performance.now() - t0) / 1000);
  const cyl = spec.banks.reduce((n, b) => n + b.cylinders.length, 0);
  console.log(
    `${idle > 300 ? "✓" : "?"} ${file.padEnd(48)} ${spec.name.padEnd(28)} ${String(cyl).padStart(2)}cil idle=${idle.toFixed(0).padStart(5)} wot=${wot.toFixed(0).padStart(5)} ${rt.toFixed(2)}x`,
  );
}
