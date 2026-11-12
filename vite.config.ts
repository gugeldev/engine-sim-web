import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // Relative base so the build works from any subpath (e.g. GitHub Pages).
  base: "./",
  plugins: [react()],
  worker: { format: "es" },
  optimizeDeps: { exclude: ["./src/sim/wasm/engine-sim.js"] },
});
