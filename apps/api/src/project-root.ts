import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function findProjectRoot(startDirectory = dirname(fileURLToPath(import.meta.url))): string {
  let directory = startDirectory;
  while (true) {
    if (existsSync(resolve(directory, "pnpm-workspace.yaml"))) return directory;
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error("Could not locate the monorepo root.");
    }
    directory = parent;
  }
}
