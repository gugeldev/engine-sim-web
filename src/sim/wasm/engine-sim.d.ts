// Types for the Emscripten module built by core/build.sh (core/bindings/bindings.cpp).
import type { EngineSpec } from "../spec";
import type { AudioParams, EngineGeometry, EngineInfo, RawEngineState } from "../protocol";

export interface EngineSimModule {
  HEAP16: Int16Array;
  HEAPF32: Float32Array;
  _malloc(bytes: number): number;
  _free(ptr: number): void;

  load(spec: EngineSpec, audioSampleRate: number): EngineInfo;
  setImpulseResponse(exhaust: number, ptr: number, samples: number, volume: number): void;
  process(samples: number, controlDt: number): number;
  audioBufferPtr(): number;

  setThrottle(value: number): void;
  setStarter(on: boolean): void;
  setIgnition(on: boolean): void;
  setClutch(pressure: number): void;
  setGear(gear: number): void;
  setSimulationSpeed(speed: number): void;
  setSimulationFrequency(frequency: number): void;
  setFluidSimulationSteps(steps: number): void;
  setDyno(enabled: boolean, hold: boolean, autoSweep: boolean, rpm: number): void;
  setAudioParameters(params: Partial<AudioParams>): void;
  getAudioParameters(): AudioParams;
  getGeometry(): EngineGeometry;
  getState(): RawEngineState;
}

declare const createEngineSim: (options?: {
  locateFile?: (file: string) => string;
}) => Promise<EngineSimModule>;
export default createEngineSim;
