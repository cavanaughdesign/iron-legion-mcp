import { z } from "zod";
import type { AgentPackManifest } from "../../orchestrator/types.js";
import { generateSummary } from "./tools/generateSummary.js";

const manifest: AgentPackManifest = {
  id: "docs",
  displayName: "Docs",
  description:
    "Generates and updates documentation artifacts for the sample repo, and reuses the state-store integration pattern proven by Tester by recording run/step status for Docs' operations.",
  tools: [
    {
      name: "generate_summary",
      description:
        "Scans the sample repo and (re)writes a generated summary doc (file list + detected test count) to sample-repo/DOCS_SUMMARY.md. Records a run and an 'edit' step in the shared state-store as it executes.",
      inputSchema: {
        projectPath: z
          .string()
          .optional()
          .describe(
            "Path recorded as the run's project_path. Defaults to the bundled sample repo root.",
          ),
      },
      handler: generateSummary,
    },
  ],
};

export default manifest;
