/// <reference lib="webworker" />
// AudioWorklet: plays the samples rendered by the engine worker. It does no
// simulation itself; it only drains a FIFO of chunks and reports how much it
// consumed so the worker can pace itself.

import type { FromWorklet, ToWorklet } from "./protocol";

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: unknown): void;

const REPORT_EVERY = 4; // render quanta (4 * 128 samples ≈ 11.6 ms)

class EngineOutputProcessor extends AudioWorkletProcessor {
  private queue: Float32Array[] = [];
  private offset = 0;
  private queued = 0;
  private consumed = 0;
  private underruns = 0;
  private quanta = 0;
  private workerPort: MessagePort | null = null;
  private primed = false;
  private last = 0;
  private epoch = 0;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<{ type: "port"; port: MessagePort }>) => {
      if (event.data.type === "port") {
        this.workerPort = event.data.port;
        this.workerPort.onmessage = (e: MessageEvent<ToWorklet>) => this.onWorkerMessage(e.data);
      }
    };
  }

  private onWorkerMessage(message: ToWorklet) {
    if (message.type === "chunk") {
      this.queue.push(message.samples);
      this.queued += message.samples.length;
    } else if (message.type === "flush") {
      this.queue = [];
      this.offset = 0;
      this.queued = 0;
      this.consumed = 0;
      this.primed = false;
      this.epoch = message.epoch;
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0];
    const left = output[0];
    const frames = left.length;

    // Wait for a small cushion before starting so we don't immediately underrun.
    if (!this.primed && this.queued >= 1024) this.primed = true;

    let written = 0;
    if (this.primed) {
      while (written < frames && this.queue.length > 0) {
        const chunk = this.queue[0];
        const n = Math.min(frames - written, chunk.length - this.offset);
        left.set(chunk.subarray(this.offset, this.offset + n), written);
        written += n;
        this.offset += n;
        if (this.offset >= chunk.length) {
          this.queue.shift();
          this.offset = 0;
        }
      }
    }

    if (written < frames) {
      // Underrun: fade the held sample to zero instead of clicking.
      for (let i = written; i < frames; i++) {
        this.last *= 0.995;
        left[i] = this.last;
      }
      if (this.primed) {
        this.underruns++;
        this.primed = false;
      }
    } else {
      this.last = left[frames - 1];
    }

    this.queued -= written;
    this.consumed += written;

    for (let c = 1; c < output.length; c++) output[c].set(left);

    if (++this.quanta >= REPORT_EVERY && this.workerPort) {
      this.quanta = 0;
      const report: FromWorklet = {
        type: "consumed",
        epoch: this.epoch,
        consumed: this.consumed,
        queued: this.queued,
        underruns: this.underruns,
      };
      this.workerPort.postMessage(report);
    }

    return true;
  }
}

registerProcessor("engine-output", EngineOutputProcessor);

void sampleRate;
