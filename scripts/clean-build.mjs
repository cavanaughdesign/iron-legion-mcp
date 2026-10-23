import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, relative } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url)),
  output = resolve(root, "dist");
if (relative(root, output) !== "dist")
  throw new Error("Unexpected build output path.");
await rm(output, { recursive: true, force: true });
