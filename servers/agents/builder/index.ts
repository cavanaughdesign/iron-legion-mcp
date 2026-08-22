import { z } from "zod";
import type { AgentPackManifest } from "../../orchestrator/types.js";
import { scaffoldFile } from "./tools/scaffoldFile.js";
import { runTests } from "./tools/runTests.js";

const manifest: AgentPackManifest = {
  id: "builder",
  displayName: "Builder",
  description: "Scaffolds files and runs tests against a target repo. The only agent pack shipped in the MVP.",
  tools: [
    {
      name: "scaffold_file",
      description: "Creates a new file with the given contents inside the sample repo (relative paths only, no path traversal).",
      inputSchema: {
        path: z.string().describe("Path relative to the sample repo root, e.g. 'src/newModule.ts'."),
        contents: z.string().describe("Full text contents to write to the file."),
        overwrite: z.boolean().optional().describe("Allow overwriting an existing file. Defaults to false."),
      },
      handler: scaffoldFile,
    },
    {
      name: "run_tests",
      description: "Runs the sample repo's test command and returns pass/fail output.",
      inputSchema: {
        pattern: z.string().optional().describe("Optional substring to filter which test files run."),
      },
      handler: runTests,
    },
  ],
};

export default manifest;
