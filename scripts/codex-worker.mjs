#!/usr/bin/env node
// Adapter for an installed Codex CLI using its existing sign-in. No API key is required by this adapter.
import { spawn } from "node:child_process";
import { writeFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
let input = "";
for await (const chunk of process.stdin) input += chunk;
const task = JSON.parse(input);
const dir = dirname(task.outputFile),
  schema = join(dir, "result.schema.json");
await writeFile(
  schema,
  JSON.stringify({
    type: "object",
    properties: {
      verdict: { type: "string", enum: ["pass", "fail", "ask"] },
      summary: { type: "string" },
      artifacts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            kind: {
              type: "string",
              enum: ["report", "test", "screenshot", "trace"],
            },
            content: { type: "string" },
          },
          required: ["name", "kind", "content"],
          additionalProperties: false,
        },
      },
    },
    required: ["verdict", "summary", "artifacts"],
    additionalProperties: false,
  }),
);
// Resolve the native executable through the npm package on Windows, avoiding cmd.exe interpolation.
let executable = process.env.IRON_LEGION_CODEX_BINARY || "codex";
if (process.platform === "win32" && !process.env.IRON_LEGION_CODEX_BINARY) {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  try {
    executable = require.resolve(
      "@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe",
      { paths: [process.env.APPDATA + "/npm/node_modules/@openai/codex"] },
    );
  } catch {
    throw new Error(
      "Set IRON_LEGION_CODEX_BINARY to the native codex.exe path; see README.",
    );
  }
}
const args = [
  "exec",
  "--ephemeral",
  "--ignore-user-config",
  "--sandbox",
  task.role === "builder" ? "workspace-write" : "read-only",
  "--add-dir",
  dir,
  "--output-schema",
  schema,
  "--output-last-message",
  task.outputFile,
  "--color",
  "never",
  "-",
];
if (process.platform === "win32")
  args.splice(1, 0, "-c", 'windows.sandbox="elevated"');
const child = spawn(executable, args, {
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});
child.stdout.pipe(process.stderr);
child.stderr.pipe(process.stderr);
child.stdin.end(
  `You are operating inside Iron Legion. Follow the task instructions. Do not invoke factory.py or modify factory state. The orchestrator owns submission, validation transitions, commits, PRs, and merges. Return ONLY the requested structured result.\n\n${input}`,
);
const code = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("close", resolve);
});
if (code !== 0) process.exit(typeof code === "number" ? code : 1);
process.stdout.write(await readFile(task.outputFile, "utf8"));
