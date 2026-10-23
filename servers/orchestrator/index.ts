#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { main } from "./main.js";
export { createIronLegion } from "./main.js";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((e) => {
    console.error(
      "[iron-legion] Startup failed:",
      e instanceof Error ? e.message : String(e),
    );
    process.exitCode = 1;
  });
