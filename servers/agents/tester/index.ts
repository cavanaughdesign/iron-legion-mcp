import { z } from "zod";
import type { AgentPackManifest } from "../../orchestrator/types.js";
import { runTests } from "./tools/runTests.js";
import { getRunStatus } from "./tools/getRunStatus.js";

const manifest: AgentPackManifest = {
  id: "tester",
  displayName: "Tester",
  description:
    "Validates what Builder produces by running the sample repo's test suite, and proves the state-store integration pattern by recording run/step status for every invocation.",
  tools: [
    {
      name: "run_tests",
      description:
        "Runs the sample repo's test suite to validate Builder's output. Records a run and a 'test' step in the shared state-store as it executes.",
      inputSchema: {
        pattern: z.string().optional().describe("Optional substring to filter which test files run."),
        projectPath: z
          .string()
          .optional()
          .describe("Path recorded as the run's project_path. Defaults to the bundled sample repo root."),
      },
      handler: runTests,
    },
    {
      name: "get_run_status",
      description: "Fetches a previously recorded run and its steps from the state-store by run id.",
      inputSchema: {
        runId: z.string().describe("The run id returned by tester__run_tests."),
      },
      handler: getRunStatus,
    },
  ],
};

export default manifest;
