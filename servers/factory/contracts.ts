import { z } from "zod";

export const text = z.string().trim().min(1).max(8000);
export const roleSchema = z.enum([
  "builder",
  "validator",
  "reviewer",
  "manager",
]);
export type Role = z.infer<typeof roleSchema>;
export const issueSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9-]{0,59}$/),
    title: text.max(180),
    body: z.string().max(16000).default(""),
    complexity: z.enum(["simple", "complex"]),
    acceptance: z.array(text.max(2000)).min(1).max(20),
    depends_on: z.array(z.string().max(60)).max(30).default([]),
  })
  .strict();
export const planSchema = z
  .object({
    release: z
      .object({
        name: text.max(160),
        type: z.enum(["greenfield", "brownfield"]),
        goal: text,
      })
      .strict(),
    issues: z.array(issueSchema).min(1).max(50),
  })
  .strict();
export type Plan = z.infer<typeof planSchema>;
export type IssueStatus =
  | "backlog"
  | "ready"
  | "claimed"
  | "in_validation"
  | "in_review"
  | "approved"
  | "merged"
  | "needs_human"
  | "dropped"
  | "cancelled";
export interface Release {
  id: string;
  project: string;
  name: string;
  type: string;
  goal: string;
  status: "draft" | "running" | "paused" | "completed" | "cancelled";
  created_at: string;
}
export interface Issue {
  id: string;
  release_id: string;
  key: string;
  title: string;
  body: string;
  complexity: "simple" | "complex";
  acceptance: string[];
  depends_on: string[];
  status: IssueStatus;
  tries: number;
  sendbacks: number;
  priority: number;
  feedback: string;
  branch: string | null;
  worktree: string | null;
  head: string | null;
  pr: number | null;
  github_issue: number | null;
  revision: number;
  updated_at: string;
}
export interface Job {
  id: string;
  issue_id: string | null;
  release_id: string;
  role: Role;
  status: string;
  token: string;
  lease_until: number;
  started_at: string;
  finished_at: string | null;
  output: string;
  head: string | null;
}
export interface Event {
  id: number;
  release_id: string;
  issue_id: string | null;
  kind: string;
  detail: string;
  created_at: string;
}
export interface Artifact {
  id: string;
  job_id: string;
  issue_id: string | null;
  kind: string;
  name: string;
  content: string;
  created_at: string;
}
export const commandSchema = z
  .object({
    executable: text.max(1024),
    args: z.array(z.string().max(4000)).max(80).default([]),
    timeoutSeconds: z.number().int().min(1).max(7200).default(900),
  })
  .strict();
export type Command = z.infer<typeof commandSchema>;
export const projectSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,59}$/),
    name: text.max(160),
    root: text.max(2048),
    baseBranch: z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,120}$/)
      .default("main"),
    executors: z
      .object({
        builder: commandSchema.optional(),
        validator: commandSchema.optional(),
        reviewer: commandSchema.optional(),
        manager: commandSchema.optional(),
      })
      .strict()
      .default({}),
    checks: z.array(commandSchema).max(20).default([]),
    github: z
      .string()
      .regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/)
      .optional(),
    autoMerge: z.boolean().default(false),
    holdouts: text.max(2048).optional(),
    isolation: z
      .enum(["trusted-process", "container"])
      .default("trusted-process"),
    containerImage: z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,200}$/)
      .optional(),
    previewUrl: z.string().url().optional(),
  })
  .strict();
export type Project = z.infer<typeof projectSchema>;
export const configSchema = z
  .object({
    projects: z.array(projectSchema).max(50).default([]),
    concurrency: z.number().int().min(1).max(8).default(2),
    managerIntervalMinutes: z.number().int().min(5).max(1440).default(180),
    maxJobsPerRelease: z.number().int().min(3).max(5000).default(500),
  })
  .strict();
export type Config = z.infer<typeof configSchema>;

const ref = { releaseId: z.string().uuid() };
const issueRef = {
  issueId: z.string().uuid(),
  revision: z.number().int().min(0),
};
export const actionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("read_artifact"),
      artifactId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal("create_release"),
      project: text.max(60),
      plan: planSchema,
      requestId: z.string().uuid(),
    })
    .strict(),
  z.object({ action: z.literal("start"), ...ref }).strict(),
  z.object({ action: z.literal("pause"), ...ref }).strict(),
  z.object({ action: z.literal("resume"), ...ref }).strict(),
  z.object({ action: z.literal("cancel"), ...ref }).strict(),
  z
    .object({
      action: z.literal("resolve"),
      ...issueRef,
      decision: z.enum(["retry", "drop"]),
      note: text,
    })
    .strict(),
  z
    .object({
      action: z.literal("feedback"),
      ...ref,
      issue: issueSchema,
      severity: z.enum(["bug", "regression", "polish"]),
      requestId: z.string().uuid(),
    })
    .strict(),
  z.object({ action: z.literal("merge"), ...issueRef }).strict(),
  z.object({ action: z.literal("sync_github"), ...ref }).strict(),
  z.object({ action: z.literal("manager"), ...ref }).strict(),
]);
export type Action = z.infer<typeof actionSchema>;
export const workerResultSchema = z
  .object({
    verdict: z.enum(["pass", "fail", "ask"]),
    summary: text,
    artifacts: z
      .array(
        z
          .object({
            name: text.max(160),
            kind: z.enum(["report", "test", "screenshot", "trace"]),
            content: z.string().max(160000),
          })
          .strict()
          .refine(
            (a) =>
              a.kind !== "screenshot" ||
              (a.content.startsWith("iVBORw0KGgo") &&
                /^[A-Za-z0-9+/=\r\n]+$/.test(a.content)),
            "Screenshot artifacts must contain base64 PNG data.",
          ),
      )
      .max(10)
      .default([]),
  })
  .strict();
export type WorkerResult = z.infer<typeof workerResultSchema>;

export function validatePlan(input: unknown): Plan & { waves: string[][] } {
  const plan = planSchema.parse(input);
  const keys = new Set<string>();
  for (const i of plan.issues) {
    if (keys.has(i.key)) throw new Error(`Duplicate issue key: ${i.key}`);
    keys.add(i.key);
    if (
      /\bHS-\d{3}\b/i.test(`${i.title}\n${i.body}\n${i.acceptance.join("\n")}`)
    )
      throw new Error(
        "Issue text must not contain private holdout references.",
      );
  }
  for (const i of plan.issues)
    for (const dep of i.depends_on)
      if (!keys.has(dep) || dep === i.key)
        throw new Error(`Invalid dependency ${dep} in ${i.key}`);
  const done = new Set<string>(),
    waves: string[][] = [];
  while (done.size < keys.size) {
    const wave = plan.issues
      .filter((i) => !done.has(i.key) && i.depends_on.every((d) => done.has(d)))
      .map((i) => i.key);
    if (!wave.length) throw new Error("Issue dependencies contain a cycle.");
    waves.push(wave);
    wave.forEach((k) => done.add(k));
  }
  return { ...plan, waves };
}
