import { cp, mkdir } from "node:fs/promises";
await mkdir("dist/servers/skills", { recursive: true });
await cp(
  "servers/skills/ai-software-factory",
  "dist/servers/skills/ai-software-factory",
  { recursive: true },
);
await cp("sample-repo", "dist/sample-repo", {
  recursive: true,
  filter: (p) =>
    !p.includes("__vitest_scratch__") && !p.endsWith("DOCS_SUMMARY.md"),
});
