/// <reference lib="webworker" />
// Engine worker: hosts the WASM engine-sim core, runs physics + audio
// synthesis ahead of playback and streams audio chunks to the AudioWorklet.

import type {
  AudioParams,
  Controls,
  FromWorker,
  FromWorklet,
  ImpulseResponseData,
  Quality,
  ToWorker,
  ToWorklet,
} from "./protocol";
import { SAMPLE_RATE } from "./protocol";
import createEngineSim, { type EngineSimModule } from "./wasm/engine-sim.js";
import wasmUrl from "./wasm/engine-sim.wasm?url";

declare const self: DedicatedWorkerGlobalScope;

const CHUNK = 512;
/** Audio kept queued ahead of playback (~70 ms). */
const TARGET_BUFFER = 3072;
const TELEMETRY_INTERVAL_MS = 1000 / 60;
const QUALITY_STEPS: Record<Exclude<Quality, "auto">, number> = { high: 8, medium: 6, low: 4 };

let wasmModule: Promise<WebAssembly.Module> | null = null;
let sim: EngineSimModule | null = null;
let workletPort: MessagePort | null = null;
let paused = false;

let produced = 0;
let consumed = 0;
let workletQueued = 0;
let underruns = 0;
let epoch = 0;

let quality: Quality = "auto";
let fluidSteps = 8;
let loadWindowCompute = 0;
let loadWindowAudio = 0;
let cpuLoad = 0;
let lastTelemetry = 0;

const controls: Controls = {
  throttle: 0,
  starter: false,
  ignition: false,
  clutch: 1,
  gear: -1,
  simulationSpeed: 1,
  dyno: { enabled: false, hold: false, autoSweep: true, rpm: 0 },
};

const post = (message: FromWorker, transfer: Transferable[] = []) =>
  self.postMessage(message, transfer);

function compileWasm(): Promise<WebAssembly.Module> {
  wasmModule ??= WebAssembly.compileStreaming(fetch(wasmUrl));
  return wasmModule;
}

/** Each engine gets a fresh module instance (the core never tears engines down). */
async function instantiate(): Promise<EngineSimModule> {
  const module = await compileWasm();
  return createEngineSim({
    instantiateWasm: (
      imports: WebAssembly.Imports,
      done: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
    ) => {
      WebAssembly.instantiate(module, imports).then((instance) => done(instance, module));
      return {};
    },
  } as Parameters<typeof createEngineSim>[0]);
}

function setImpulse(target: EngineSimModule, exhaust: number, data: ImpulseResponseData) {
  const ptr = target._malloc(data.samples.byteLength);
  target.HEAP16.set(data.samples, ptr >> 1);
  target.setImpulseResponse(exhaust, ptr, data.samples.length, data.volume);
  target._free(ptr);
}

function applyControls(target: EngineSimModule) {
  target.setThrottle(controls.throttle);
  target.setStarter(controls.starter);
  target.setIgnition(controls.ignition);
  target.setClutch(controls.clutch);
  target.setSimulationSpeed(controls.simulationSpeed);
  const d = controls.dyno;
  target.setDyno(d.enabled, d.hold, d.autoSweep, d.rpm);
}

function flushWorklet() {
  epoch++;
  const message: ToWorklet = { type: "flush", epoch };
  workletPort?.postMessage(message);
  produced = 0;
  consumed = 0;
  workletQueued = 0;
}

async function load(message: Extract<ToWorker, { type: "load" }>) {
  sim = null;
  flushWorklet();

  const next = await instantiate();
  const info = next.load(message.spec, SAMPLE_RATE);
  message.impulseResponses.forEach((ir, i) => {
    setImpulse(next, i, ir);
  });
  if (message.audio) next.setAudioParameters(message.audio);

  fluidSteps =
    quality === "auto" ? (message.spec.fluidSimulationSteps ?? 8) : QUALITY_STEPS[quality];
  next.setFluidSimulationSteps(fluidSteps);

  // A freshly loaded engine is stopped; keep gear/ignition consistent with it.
  controls.gear = -1;
  controls.starter = false;
  controls.dyno = { ...controls.dyno, enabled: false, hold: false };
  applyControls(next);

  sim = next;
  post({
    type: "loaded",
    info,
    geometry: next.getGeometry(),
    audio: next.getAudioParameters(),
  });
  pump();
}

function adaptQuality() {
  if (!sim || quality !== "auto") return;
  if (cpuLoad > 0.85 && fluidSteps > 4) fluidSteps -= 2;
  else if (cpuLoad < 0.45 && fluidSteps < 8) fluidSteps += 2;
  else return;
  sim.setFluidSimulationSteps(fluidSteps);
}

function produceChunk(target: EngineSimModule) {
  const t0 = performance.now();
  const n = target.process(CHUNK, CHUNK / SAMPLE_RATE);
  const computeMs = performance.now() - t0;

  loadWindowCompute += computeMs;
  loadWindowAudio += (CHUNK / SAMPLE_RATE) * 1000;
  if (loadWindowAudio >= 1000) {
    cpuLoad = loadWindowCompute / loadWindowAudio;
    loadWindowCompute = 0;
    loadWindowAudio = 0;
    adaptQuality();
  }

  if (n > 0) {
    const samples = new Float32Array(target.HEAPF32.buffer, target.audioBufferPtr(), n).slice();
    const message: ToWorklet = { type: "chunk", samples };
    workletPort?.postMessage(message, [samples.buffer]);
    produced += n;
  }
}

function sendTelemetry(target: EngineSimModule) {
  const now = performance.now();
  if (now - lastTelemetry < TELEMETRY_INTERVAL_MS) return;
  lastTelemetry = now;
  const raw = target.getState();
  post(
    { type: "state", state: { ...raw, load: cpuLoad, bufferedSamples: workletQueued, underruns } },
    [raw.cylinders.buffer],
  );
}

function pump() {
  const target = sim;
  if (!target || paused || !workletPort) return;

  const start = performance.now();
  while (produced - consumed < TARGET_BUFFER) {
    produceChunk(target);
    // Never block the worker for long; the next worklet report resumes us.
    if (performance.now() - start > 25) break;
  }
  sendTelemetry(target);
}

function onWorkletMessage(event: MessageEvent<FromWorklet>) {
  const message = event.data;
  if (message.type === "consumed" && message.epoch === epoch) {
    consumed = message.consumed;
    workletQueued = message.queued;
    underruns = message.underruns;
    pump();
  }
}

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  switch (message.type) {
    case "init":
      workletPort = message.port;
      workletPort.onmessage = onWorkletMessage;
      compileWasm()
        .then(() => post({ type: "ready" }))
        .catch((error: unknown) => post({ type: "error", message: String(error) }));
      break;
    case "load":
      load(message).catch((error: unknown) => {
        post({ type: "error", message: error instanceof Error ? error.message : String(error) });
      });
      break;
    case "controls":
      Object.assign(controls, message.controls);
      if (message.controls.dyno) controls.dyno = { ...controls.dyno, ...message.controls.dyno };
      if (sim) {
        applyControls(sim);
        if (message.controls.gear !== undefined) sim.setGear(message.controls.gear);
      }
      break;
    case "audio":
      sim?.setAudioParameters(message.params as Partial<AudioParams>);
      break;
    case "impulse":
      if (sim) setImpulse(sim, message.exhaust, message.data);
      break;
    case "quality":
      quality = message.quality;
      if (quality !== "auto") fluidSteps = QUALITY_STEPS[quality];
      sim?.setFluidSimulationSteps(fluidSteps);
      break;
    case "pause":
      paused = message.paused;
      if (!paused) pump();
      break;
  }
};
