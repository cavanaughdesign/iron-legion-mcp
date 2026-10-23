// Deterministic test worker. This deliberately does not call an AI provider.
import { readFile, writeFile } from "node:fs/promises";
let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const task = JSON.parse(raw);
if (task.issue?.title.includes("[slow]"))
  await new Promise((r) => setTimeout(r, 30000));
if (task.role === "builder" && task.issue?.title.includes("[ask]")) {
  process.stdout.write(
    JSON.stringify({
      verdict: "ask",
      summary: "Which behavior should be used?",
      artifacts: [],
    }),
  );
  process.exit(0);
}
if (task.role === "builder" && task.issue?.title.includes("[fail]")) {
  process.stdout.write(
    JSON.stringify({
      verdict: "fail",
      summary: "Observable fixture failure.",
      artifacts: [],
    }),
  );
  process.exit(0);
}
if (task.role === "builder")
  await writeFile(`${task.issue.key}.txt`, `${task.issue.title}\n`);
if (task.role === "validator") await readFile(`${task.issue.key}.txt`, "utf8");
process.stdout.write(
  JSON.stringify({
    verdict: "pass",
    summary: `${task.role} fixture completed independently.`,
    artifacts: [
      {
        kind: "report",
        name: `${task.role}-evidence.txt`,
        content: `Fixture role: ${task.role}. Candidate: ${task.candidate || "new change"}.`,
      },
    ],
  }),
);
