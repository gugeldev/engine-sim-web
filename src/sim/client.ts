import workletUrl from "./audio-worklet.ts?worker&url";
import EngineWorker from "./engine-worker.ts?worker";
import type {
  AudioParams,
  ControlsPatch,
  EngineGeometry,
  EngineInfo,
  EngineState,
  FromWorker,
  Quality,
  ToWorker,
} from "./protocol";
import { SAMPLE_RATE } from "./protocol";
import { loadImpulseResponse } from "./sounds";
import type { EngineSpec } from "./spec";

export type LoadedEngine = { info: EngineInfo; geometry: EngineGeometry; audio: AudioParams };

type Listener = (state: EngineState) => void;

/**
 * Main-thread facade over the engine worker + audio graph:
 *
 *   [Worker: WASM physics + synth] --MessagePort--> [AudioWorklet] -> gain -> analyser -> out
 */
export class EngineClient {
  readonly context: AudioContext;
  readonly analyser: AnalyserNode;
  private readonly gain: GainNode;
  private readonly worker: Worker;
  private node: AudioWorkletNode | null = null;
  private listeners = new Set<Listener>();
  private pendingLoad: {
    resolve: (v: LoadedEngine) => void;
    reject: (e: Error) => void;
  } | null = null;
  private ready: Promise<void>;
  latest: EngineState | null = null;

  constructor() {
    this.context = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: "interactive" });
    this.gain = this.context.createGain();
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 2048;
    this.gain.connect(this.analyser);
    this.analyser.connect(this.context.destination);

    this.worker = new EngineWorker();
    this.worker.onmessage = (event: MessageEvent<FromWorker>) => this.onMessage(event.data);
    this.ready = this.setup();
  }

  private async setup() {
    await this.context.audioWorklet.addModule(workletUrl);
    this.node = new AudioWorkletNode(this.context, "engine-output", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    this.node.connect(this.gain);

    const channel = new MessageChannel();
    this.node.port.postMessage({ type: "port", port: channel.port1 }, [channel.port1]);

    const ready = new Promise<void>((resolve, reject) => {
      const onReady = (event: MessageEvent<FromWorker>) => {
        if (event.data.type === "ready") {
          this.worker.removeEventListener("message", onReady);
          resolve();
        } else if (event.data.type === "error") {
          reject(new Error(event.data.message));
        }
      };
      this.worker.addEventListener("message", onReady);
    });
    this.send({ type: "init", port: channel.port2 }, [channel.port2]);
    await ready;
  }

  private send(message: ToWorker, transfer: Transferable[] = []) {
    this.worker.postMessage(message, transfer);
  }

  private onMessage(message: FromWorker) {
    switch (message.type) {
      case "state":
        this.latest = message.state;
        for (const listener of this.listeners) listener(message.state);
        break;
      case "loaded":
        this.pendingLoad?.resolve({
          info: message.info,
          geometry: message.geometry,
          audio: message.audio,
        });
        this.pendingLoad = null;
        break;
      case "error":
        this.pendingLoad?.reject(new Error(message.message));
        this.pendingLoad = null;
        console.error("[engine-worker]", message.message);
        break;
    }
  }

  async resume() {
    await this.ready;
    if (this.context.state !== "running") await this.context.resume();
  }

  async load(spec: EngineSpec, audio?: Partial<AudioParams>): Promise<LoadedEngine> {
    await this.ready;
    const irs = await Promise.all(
      spec.exhausts.map(async (ex) => ({
        samples: (await loadImpulseResponse(ex.impulseResponse)).slice(),
        volume: ex.impulseVolume,
      })),
    );
    this.pendingLoad?.reject(new Error("superseded"));
    const result = new Promise<LoadedEngine>((resolve, reject) => {
      this.pendingLoad = { resolve, reject };
    });
    this.send(
      { type: "load", spec, impulseResponses: irs, audio },
      irs.map((ir) => ir.samples.buffer),
    );
    return result;
  }

  async setImpulseResponse(exhaust: number, id: string, volume: number) {
    const samples = (await loadImpulseResponse(id)).slice();
    this.send({ type: "impulse", exhaust, data: { samples, volume } }, [samples.buffer]);
  }

  setControls(controls: ControlsPatch) {
    this.send({ type: "controls", controls });
  }

  setAudio(params: Partial<AudioParams>) {
    this.send({ type: "audio", params });
  }

  setQuality(quality: Quality) {
    this.send({ type: "quality", quality });
  }

  setMasterVolume(volume: number) {
    this.gain.gain.setTargetAtTime(volume, this.context.currentTime, 0.02);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

let instance: EngineClient | null = null;
export const getEngineClient = () => {
  instance ??= new EngineClient();
  return instance;
};
