/** Generates every layout with default parameters and checks it starts and revs. */
import { resolve } from "node:path";
import { configs, defaultParams, generateEngine } from "../src/sim/generator";
import createEngineSim from "../src/sim/wasm/engine-sim.js";

for (const config of configs.filter((c) => c.id.includes(process.argv[2] ?? ""))) {
  const spec = generateEngine({
    ...defaultParams,
    configId: config.id,
    vAngle: config.vAngle ?? 90,
  });
  const mod = await createEngineSim({
    locateFile: (f: string) => resolve(import.meta.dir, "../src/sim/wasm", f),
  });
  mod.load(spec, 44100);
  const step = (s: number) => {
    for (let i = 0; i < Math.round((s * 44100) / 512); i++) mod.process(512, 512 / 44100);
    return mod.getState();
  };
  mod.setIgnition(true);
  mod.setStarter(true);
  step(3);
  mod.setStarter(false);
  const idle = step(2);
  mod.setThrottle(1);
  const wot = step(2);
  console.log(
    `${idle.rpm > 400 && wot.rpm > 4000 ? "✓" : "?"} ${config.label.padEnd(20)} idle=${idle.rpm.toFixed(0).padStart(5)} map=${(idle.manifoldPressure / 1000).toFixed(0).padStart(3)}kPa wot=${wot.rpm.toFixed(0).padStart(5)}`,
  );
}
