/**
 * Headless smoke test: runs an engine preset in Bun/Node without a browser,
 * prints RPM/torque over time and writes the rendered audio to a WAV file.
 *
 *   bun scripts/headless.ts [engines/<file>.mr] [out.wav]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { EngineSpec } from "../src/sim/spec";
import createEngineSim from "../src/sim/wasm/engine-sim.js";
import { decodeWavToInt16, encodeWav } from "../src/sim/wav";
import { specFromLibraryFile } from "./mr-node";

const file = process.argv[2] ?? "engines/atg-video-2/07_gm_ls.mr";
const outPath = process.argv[3];
const spec: EngineSpec = specFromLibraryFile(file);

const root = resolve(import.meta.dir, "..");
const mod = await createEngineSim({
  locateFile: (f: string) => resolve(root, "src/sim/wasm", f),
});

const info = mod.load(spec, 44100);
console.log("loaded", info);

spec.exhausts.forEach((ex, i) => {
  const pcm = decodeWavToInt16(
    readFileSync(resolve(root, "public/ir", `${ex.impulseResponse}.wav`)).buffer,
  );
  const ptr = mod._malloc(pcm.byteLength);
  mod.HEAP16.set(pcm, ptr >> 1);
  mod.setImpulseResponse(i, ptr, pcm.length, ex.impulseVolume);
  mod._free(ptr);
});

const block = 512;
const dt = block / 44100;
const out: number[] = [];
const t0 = performance.now();
let simulated = 0;

const run = (seconds: number, label: string) => {
  const blocks = Math.round(seconds / dt);
  for (let b = 0; b < blocks; b++) {
    const n = mod.process(block, dt);
    const view = new Float32Array(mod.HEAPF32.buffer, mod.audioBufferPtr(), n);
    for (let i = 0; i < n; i++) out.push(view[i]);
    simulated += dt;
  }
  const s = mod.getState();
  console.log(
    `${label.padEnd(18)} t=${simulated.toFixed(2)}s rpm=${s.rpm.toFixed(0).padStart(5)} ` +
      `map=${(s.manifoldPressure / 1000).toFixed(1)}kPa torque=${s.dynoTorque.toFixed(1)}Nm ` +
      `samples=${out.length}`,
  );
};

mod.setIgnition(true);
mod.setStarter(true);
run(4.0, "cranking");
mod.setStarter(false);
run(1.5, "idle");
mod.setThrottle(1.0);
run(1.5, "full throttle");
mod.setThrottle(0.0);
run(1.5, "lift off");

const elapsed = (performance.now() - t0) / 1000;
console.log(`realtime factor: ${(simulated / elapsed).toFixed(2)}x (${elapsed.toFixed(2)}s wall)`);

const samples = Float32Array.from(out);
let peak = 0;
let sumSq = 0;
let nans = 0;
for (const v of samples) {
  if (Number.isNaN(v)) nans++;
  peak = Math.max(peak, Math.abs(v));
  sumSq += v * v;
}
console.log(
  `audio: peak=${peak.toFixed(3)} rms=${Math.sqrt(sumSq / samples.length).toFixed(4)} nans=${nans}`,
);

if (outPath) {
  writeFileSync(outPath, Buffer.from(encodeWav(samples)));
  console.log("wrote", outPath);
}
