# engine-sim web

Combustion engine simulator in the browser, with sound generated from real-time physics.
A web port of [engine-sim](https://github.com/ange-yaghi/engine-sim) by Ange Yaghi (MIT).

**Live:** https://gugeldev.github.io/engine-sim-web/

## How it works

- The original C++ core (physics + audio synthesizer) is compiled to WebAssembly and runs in a Web Worker.
- An AudioWorklet plays the generated audio; a React + three.js UI renders the engine and telemetry.
- Engines are the original Piranha (`.mr`) scripts, interpreted in the browser (`src/mr/`). You can also import your own `.mr` files or build one with the parametric generator (inline, V, boxer; 1–12 cylinders).

## Development

```bash
bun install
bun run dev      # http://localhost:5173
bun run build    # production build to dist/
bun run check    # Biome lint + format
```

The prebuilt `.wasm` lives in `src/sim/wasm/`. To rebuild the C++ core you need [Emscripten](https://emscripten.org) (expected at `~/emsdk`):

```bash
bun run build:wasm
```

Headless checks:

```bash
bun scripts/headless.ts engines/atg-video-2/07_gm_ls.mr out.wav
bun scripts/check-mr.ts
bun scripts/check-generator.ts
```

## Controls

| Key           | Action                          |
| ------------- | ------------------------------- |
| A             | Ignition                        |
| S (hold)      | Starter motor                   |
| Q / W / E / R | Throttle 1/10/20/100% while held |
| Space + wheel | Fine throttle                   |
| ↑ / ↓         | Gears                           |
| Shift         | Clutch                          |
| D / H         | Dyno / hold RPM                 |
| 1…5           | Slow motion                     |

## Deploy

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every push to `main`.

## License

MIT. Includes code from engine-sim and simple-2d-constraint-solver © Ange Yaghi, under MIT
(see `core/engine-sim/LICENSE`). Impulse response files in `public/ir` come from engine-sim.
