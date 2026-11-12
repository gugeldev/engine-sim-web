import { create } from "zustand";
import { catalog, catalogSpec } from "./mr/catalog";
import { type EngineClient, getEngineClient } from "./sim/client";
import type {
  AudioParams,
  Controls,
  ControlsPatch,
  EngineGeometry,
  EngineInfo,
  Quality,
} from "./sim/protocol";
import {
  builtinImpulseResponses,
  type ImpulseResponseInfo,
  listCustomImpulseResponses,
} from "./sim/sounds";
import type { EngineSpec } from "./sim/spec";

export type SavedEngine = { id: string; name: string; spec: EngineSpec; savedAt: number };

type Status = "off" | "starting" | "loading" | "running" | "error";

type AppState = {
  status: Status;
  error: string | null;
  client: EngineClient | null;

  /** Id of the preset or saved engine currently loaded. */
  sourceId: string;
  spec: EngineSpec;
  info: EngineInfo | null;
  geometry: EngineGeometry | null;
  audio: AudioParams | null;
  /** Audio overrides the user made; kept when switching engines. */
  audioOverrides: Partial<AudioParams>;

  controls: Controls;
  quality: Quality;
  masterVolume: number;
  savedEngines: SavedEngine[];
  impulseLibrary: ImpulseResponseInfo[];

  power: () => Promise<void>;
  loadSpec: (spec: EngineSpec, sourceId: string) => Promise<void>;
  selectSource: (id: string) => Promise<void>;
  setControls: (controls: ControlsPatch) => void;
  setAudio: (params: Partial<AudioParams>) => void;
  resetAudio: () => void;
  setQuality: (quality: Quality) => void;
  setMasterVolume: (volume: number) => void;
  setExhaustSound: (exhaust: number, id: string, volume: number) => void;
  saveEngine: (spec: EngineSpec) => string;
  deleteSavedEngine: (id: string) => void;
  refreshImpulseLibrary: () => Promise<void>;
};

const SAVED_KEY = "engine-sim-web:saved-engines";
const PREFS_KEY = "engine-sim-web:prefs";
export const DEFAULT_ENGINE = "gm-ls";
void catalog;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable (private mode / quota) – preferences just won't persist
  }
}

type Prefs = {
  sourceId: string;
  quality: Quality;
  masterVolume: number;
  audioOverrides: Partial<AudioParams>;
};

const prefs = readJson<Prefs>(PREFS_KEY, {
  sourceId: DEFAULT_ENGINE,
  quality: "auto",
  masterVolume: 0.8,
  audioOverrides: {},
});

const savedEngines = readJson<SavedEngine[]>(SAVED_KEY, []);

function findSpec(id: string): EngineSpec | null {
  const preset = catalogSpec(id);
  if (preset) return preset;
  return savedEngines.find((s) => s.id === id)?.spec ?? null;
}

function safeFindSpec(id: string): EngineSpec | null {
  try {
    return findSpec(id);
  } catch (error) {
    console.error(error);
    return null;
  }
}

const initialSourceId = safeFindSpec(prefs.sourceId) ? prefs.sourceId : DEFAULT_ENGINE;

export const useApp = create<AppState>((set, get) => {
  const persistPrefs = () => {
    const { sourceId, quality, masterVolume, audioOverrides } = get();
    writeJson(PREFS_KEY, { sourceId, quality, masterVolume, audioOverrides } satisfies Prefs);
  };

  return {
    status: "off",
    error: null,
    client: null,
    sourceId: initialSourceId,
    spec: structuredClone(
      safeFindSpec(initialSourceId) ?? (catalogSpec(DEFAULT_ENGINE) as EngineSpec),
    ),
    info: null,
    geometry: null,
    audio: null,
    audioOverrides: prefs.audioOverrides,
    controls: {
      throttle: 0,
      starter: false,
      ignition: false,
      clutch: 1,
      gear: -1,
      simulationSpeed: 1,
      dyno: { enabled: false, hold: false, autoSweep: true, rpm: 0 },
    },
    quality: prefs.quality,
    masterVolume: prefs.masterVolume,
    savedEngines,
    impulseLibrary: builtinImpulseResponses,

    power: async () => {
      if (get().status !== "off" && get().status !== "error") return;
      set({ status: "starting", error: null });
      try {
        const client = getEngineClient();
        await client.resume();
        client.setMasterVolume(get().masterVolume);
        client.setQuality(get().quality);
        set({ client });
        await get().refreshImpulseLibrary();
        await get().loadSpec(get().spec, get().sourceId);
      } catch (error) {
        set({ status: "error", error: error instanceof Error ? error.message : String(error) });
      }
    },

    loadSpec: async (spec, sourceId) => {
      const client = get().client;
      set({ spec, sourceId });
      persistPrefs();
      if (!client) return;
      set({ status: "loading" });
      try {
        const loaded = await client.load(spec, get().audioOverrides);
        set((s) => ({
          status: "running",
          info: loaded.info,
          geometry: loaded.geometry,
          audio: loaded.audio,
          controls: {
            ...s.controls,
            gear: -1,
            starter: false,
            dyno: { ...s.controls.dyno, enabled: false, hold: false },
          },
        }));
        // Engines load stopped; keep the user's ignition/throttle choices.
        client.setControls({
          ignition: get().controls.ignition,
          throttle: get().controls.throttle,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message !== "superseded") set({ status: "error", error: message });
      }
    },

    selectSource: async (id) => {
      const spec = findSpec(id) ?? get().savedEngines.find((s) => s.id === id)?.spec;
      if (!spec) return;
      await get().loadSpec(structuredClone(spec), id);
    },

    setControls: (controls) => {
      set((s) => ({
        controls: {
          ...s.controls,
          ...controls,
          dyno: controls.dyno ? { ...s.controls.dyno, ...controls.dyno } : s.controls.dyno,
        },
      }));
      get().client?.setControls(controls);
    },

    setAudio: (params) => {
      set((s) => ({
        audio: s.audio ? { ...s.audio, ...params } : s.audio,
        audioOverrides: { ...s.audioOverrides, ...params },
      }));
      get().client?.setAudio(params);
      persistPrefs();
    },

    resetAudio: () => {
      set({ audioOverrides: {} });
      persistPrefs();
      void get().loadSpec(get().spec, get().sourceId);
    },

    setQuality: (quality) => {
      set({ quality });
      get().client?.setQuality(quality);
      persistPrefs();
    },

    setMasterVolume: (masterVolume) => {
      set({ masterVolume });
      get().client?.setMasterVolume(masterVolume);
      persistPrefs();
    },

    setExhaustSound: (exhaust, id, volume) => {
      set((s) => {
        const spec = structuredClone(s.spec);
        spec.exhausts[exhaust] = {
          ...spec.exhausts[exhaust],
          impulseResponse: id,
          impulseVolume: volume,
        };
        return { spec };
      });
      void get().client?.setImpulseResponse(exhaust, id, volume);
    },

    saveEngine: (spec) => {
      const existing = get().savedEngines.find((e) => e.id === get().sourceId);
      const id = existing ? existing.id : `saved:${crypto.randomUUID()}`;
      const entry: SavedEngine = {
        id,
        name: spec.name,
        spec: structuredClone(spec),
        savedAt: Date.now(),
      };
      const list = [entry, ...get().savedEngines.filter((e) => e.id !== id)];
      savedEngines.splice(0, savedEngines.length, ...list);
      writeJson(SAVED_KEY, list);
      set({ savedEngines: list, sourceId: id });
      persistPrefs();
      return id;
    },

    deleteSavedEngine: (id) => {
      const list = get().savedEngines.filter((e) => e.id !== id);
      savedEngines.splice(0, savedEngines.length, ...list);
      writeJson(SAVED_KEY, list);
      set({ savedEngines: list });
    },

    refreshImpulseLibrary: async () => {
      const custom = await listCustomImpulseResponses();
      set({ impulseLibrary: [...builtinImpulseResponses, ...custom] });
    },
  };
});
