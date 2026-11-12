import type { EngineSpec } from "../sim/spec";
import { Interpreter } from "./interpreter";
import { toSpec } from "./to-spec";

/** Every .mr file from engine-sim's library (es/) and example engines, bundled as text. */
const files: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>("./library/**/*.mr", {
      query: "?raw",
      import: "default",
      eager: true,
    }),
  ).map(([path, source]) => [path.replace("./library/", ""), source]),
);

export type CatalogEntry = {
  id: string;
  name: string;
  description: string;
  group: string;
  file: string;
};

export const catalog: CatalogEntry[] = [
  // Pequenos
  {
    id: "honda-trx520",
    name: "Honda TRX520",
    description: "Monocilíndrico de quadriciclo, 518 cc",
    group: "Pequenos",
    file: "engines/atg-video-1/01_honda_trx520.mr",
  },
  {
    id: "kohler-ch750",
    name: "Kohler CH750",
    description: "V-twin de cortador de grama com governador",
    group: "Pequenos",
    file: "engines/atg-video-1/02_kohler_ch750.mr",
  },
  {
    id: "harley-shovelhead",
    name: "Harley-Davidson Shovelhead",
    description: "V-twin 45° — o 'potato-potato'",
    group: "Pequenos",
    file: "engines/atg-video-1/03_harley_davidson_shovelhead.mr",
  },
  {
    id: "suzuki-hayabusa",
    name: "Suzuki Hayabusa",
    description: "4 em linha de moto, gira acima de 10 mil",
    group: "Pequenos",
    file: "engines/atg-video-1/04_hayabusa.mr",
  },
  // 4, 5 e 6 cilindros
  {
    id: "honda-b18c5",
    name: "Honda B18C5 VTEC",
    description: "4 em linha com VTEC: o comando muda acima de ~5.800 rpm",
    group: "4 a 6 cilindros",
    file: "engines/atg-video-1/05_honda_vtec.mr",
  },
  {
    id: "subaru-ej25-eh",
    name: "Subaru EJ25 (coletor igual)",
    description: "Boxer 2.5 com coletor de comprimentos iguais",
    group: "4 a 6 cilindros",
    file: "engines/atg-video-2/01_subaru_ej25_eh.mr",
  },
  {
    id: "subaru-ej25-uh",
    name: "Subaru EJ25 (coletor desigual)",
    description: "O clássico ronco 'boxer rumble'",
    group: "4 a 6 cilindros",
    file: "engines/atg-video-2/02_subaru_ej25_uh.mr",
  },
  {
    id: "audi-i5",
    name: "Audi 2.3 5 cilindros",
    description: "O som de rali dos anos 80",
    group: "4 a 6 cilindros",
    file: "engines/atg-video-1/07_audi_i5.mr",
  },
  {
    id: "toyota-2jz",
    name: "Toyota 2JZ",
    description: "6 em linha 3.0 do Supra",
    group: "4 a 6 cilindros",
    file: "engines/atg-video-2/03_2jz.mr",
  },
  {
    id: "bmw-m52b28",
    name: "BMW M52B28",
    description: "6 em linha 2.8 dos anos 90",
    group: "4 a 6 cilindros",
    file: "engines/bmw/M52B28.mr",
  },
  {
    id: "v6-60",
    name: "V6 60°",
    description: "V6 genérico a 60°, disparo regular",
    group: "4 a 6 cilindros",
    file: "engines/atg-video-2/04_60_degree_v6.mr",
  },
  {
    id: "v6-odd-fire",
    name: "V6 90° odd-fire",
    description: "Munhões compartilhados: disparo irregular",
    group: "4 a 6 cilindros",
    file: "engines/atg-video-2/05_odd_fire_v6.mr",
  },
  {
    id: "v6-even-fire",
    name: "V6 90° even-fire",
    description: "Munhões defasados: disparo regular",
    group: "4 a 6 cilindros",
    file: "engines/atg-video-2/06_even_fire_v6.mr",
  },
  // V8+
  {
    id: "gm-ls",
    name: "GM LS V8",
    description: "V8 5.3 cross-plane",
    group: "V8 e maiores",
    file: "engines/atg-video-2/07_gm_ls.mr",
  },
  {
    id: "chevy-454",
    name: "Chevrolet 454 V8",
    description: "Big block 7.4 carburado",
    group: "V8 e maiores",
    file: "engines/chevrolet/chev_truck_454.mr",
  },
  {
    id: "audi-rs6-v8",
    name: "Audi RS6 4.0 V8",
    description: "V8 4.0 cross-plane do RS6 (C8), câmbio de 8 marchas — sem turbo",
    group: "V8 e maiores",
    file: "engines/audi/rs6_v8.mr",
  },
  {
    id: "ferrari-f136",
    name: "Ferrari F136 V8",
    description: "V8 4.5 flat-plane, corta a 9.300 rpm",
    group: "V8 e maiores",
    file: "engines/atg-video-2/08_ferrari_f136_v8.mr",
  },
  {
    id: "lexus-lfa",
    name: "Lexus LFA V10",
    description: "V10 4.8 a 72°, grita até 9.500 rpm",
    group: "V8 e maiores",
    file: "engines/atg-video-2/10_lfa_v10.mr",
  },
  {
    id: "ferrari-412-t2",
    name: "Ferrari 412 T2 V12",
    description: "V12 de Fórmula 1 (1995), passa de 15 mil rpm",
    group: "V8 e maiores",
    file: "engines/atg-video-2/12_ferrari_412_t2.mr",
  },
  // Aviação
  {
    id: "radial-5",
    name: "Radial 5 cilindros",
    description: "Motor estrela com biela-mestre",
    group: "Aviação",
    file: "engines/atg-video-1/08_radial_5.mr",
  },
  {
    id: "radial-9",
    name: "Radial 9 cilindros",
    description: "Estrela de 9 cilindros, baixa rotação",
    group: "Aviação",
    file: "engines/atg-video-2/09_radial_9.mr",
  },
  {
    id: "merlin-v12",
    name: "Rolls-Royce Merlin V12",
    description: "27 L do Spitfire/Mustang — segure o arranque ~6 s",
    group: "Aviação",
    file: "engines/atg-video-2/11_merlin_v12.mr",
  },
];

const cache = new Map<string, EngineSpec>();

/** Runs a .mr file (plus optional extra user files) and converts the result. */
export function specFromMr(entry: string, extraFiles: Record<string, string> = {}): EngineSpec {
  const interp = new Interpreter((path) => extraFiles[path] ?? files[path] ?? null);
  interp.run(entry);
  return toSpec(interp.result);
}

export function catalogSpec(id: string): EngineSpec | null {
  const entry = catalog.find((e) => e.id === id);
  if (!entry) return null;
  let spec = cache.get(id);
  if (!spec) {
    spec = specFromMr(entry.file);
    spec.name = entry.name;
    cache.set(id, spec);
  }
  return spec;
}
