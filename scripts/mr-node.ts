// Node/Bun helper: runs a .mr file from src/mr/library using the filesystem.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Interpreter } from "../src/mr/interpreter";
import { toSpec } from "../src/mr/to-spec";

const root = resolve(import.meta.dir, "../src/mr/library");

export function specFromLibraryFile(path: string) {
  const interp = new Interpreter((p) => {
    const full = resolve(root, p);
    return existsSync(full) ? readFileSync(full, "utf8") : null;
  });
  interp.run(path);
  return toSpec(interp.result);
}
