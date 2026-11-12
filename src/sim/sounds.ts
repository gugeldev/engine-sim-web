import { decodeWavToInt16 } from "./wav";

/**
 * Impulse responses ("exhaust character"). The engine signal is convolved with
 * one of these per exhaust system. Built-ins come from engine-sim's sound
 * library; users can add their own WAV files (stored in IndexedDB).
 */
export type ImpulseResponseInfo = {
  id: string;
  name: string;
  description: string;
  /** Volume the original library used for this file. */
  defaultVolume: number;
  custom?: boolean;
};

export const builtinImpulseResponses: ImpulseResponseInfo[] = [
  {
    id: "smooth-39",
    name: "Suave",
    description: "Padrão do engine-sim, encorpado",
    defaultVolume: 0.001,
  },
  { id: "sharp-01", name: "Agudo", description: "Mais rasgado e metálico", defaultVolume: 0.001 },
  {
    id: "mild-exhaust",
    name: "Escape esportivo",
    description: "Abafamento leve",
    defaultVolume: 0.01,
  },
  {
    id: "mild-exhaust-reverb",
    name: "Escape esportivo + reverb",
    description: "Como o anterior, com ambiência",
    defaultVolume: 0.01,
  },
  {
    id: "minimal-muffling-01",
    name: "Direto 1",
    description: "Quase sem abafador",
    defaultVolume: 0.01,
  },
  {
    id: "minimal-muffling-02",
    name: "Direto 2",
    description: "Quase sem abafador",
    defaultVolume: 0.01,
  },
  {
    id: "minimal-muffling-03",
    name: "Direto 3",
    description: "Quase sem abafador",
    defaultVolume: 0.01,
  },
  {
    id: "real-engine-14",
    name: "Gravação real A",
    description: "IR de motor gravado",
    defaultVolume: 0.001,
  },
  {
    id: "real-engine-15",
    name: "Gravação real B",
    description: "IR de motor gravado",
    defaultVolume: 0.001,
  },
  {
    id: "real-engine-16",
    name: "Gravação real C",
    description: "IR de motor gravado",
    defaultVolume: 0.001,
  },
];

const cache = new Map<string, Promise<Int16Array>>();

export function loadImpulseResponse(id: string): Promise<Int16Array> {
  let entry = cache.get(id);
  if (!entry) {
    entry = id.startsWith("custom:")
      ? readCustom(id).then((buffer) => decodeWavToInt16(buffer))
      : fetch(`${import.meta.env.BASE_URL}ir/${id}.wav`)
          .then((r) => {
            if (!r.ok) throw new Error(`IR ${id}: HTTP ${r.status}`);
            return r.arrayBuffer();
          })
          .then((buffer) => decodeWavToInt16(buffer));
    cache.set(id, entry);
    entry.catch(() => cache.delete(id));
  }
  return entry;
}

// ---------------------------------------------------------------------------
// Custom impulse responses (IndexedDB)
// ---------------------------------------------------------------------------

const DB_NAME = "engine-sim-web";
const STORE = "impulse-responses";

type StoredIr = { id: string; name: string; data: ArrayBuffer };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = fn(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readCustom(id: string): Promise<ArrayBuffer> {
  const entry = await withStore<StoredIr | undefined>("readonly", (s) => s.get(id));
  if (!entry) throw new Error(`Som personalizado não encontrado: ${id}`);
  return entry.data;
}

export async function listCustomImpulseResponses(): Promise<ImpulseResponseInfo[]> {
  try {
    const all = await withStore<StoredIr[]>("readonly", (s) => s.getAll());
    return all.map((e) => ({
      id: e.id,
      name: e.name,
      description: "Enviado por você",
      defaultVolume: 0.01,
      custom: true,
    }));
  } catch {
    return [];
  }
}

/** Validates and stores a user WAV file; returns its library entry. */
export async function addCustomImpulseResponse(file: File): Promise<ImpulseResponseInfo> {
  const data = await file.arrayBuffer();
  decodeWavToInt16(data); // throws on unsupported files
  const id = `custom:${crypto.randomUUID()}`;
  const name = file.name.replace(/\.wav$/i, "");
  await withStore("readwrite", (s) => s.put({ id, name, data } satisfies StoredIr));
  return { id, name, description: "Enviado por você", defaultVolume: 0.01, custom: true };
}

export async function removeCustomImpulseResponse(id: string): Promise<void> {
  cache.delete(id);
  await withStore("readwrite", (s) => s.delete(id));
}
