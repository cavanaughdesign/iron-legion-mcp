import { existsSync, readFileSync, realpathSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, relative, isAbsolute, join } from "node:path";
import { configSchema, type Config } from "./contracts.js";

export const dataHome = resolve(
  process.env.IRON_LEGION_HOME || join(homedir(), ".iron-legion"),
);
export function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..`) && !isAbsolute(rel));
}
export function loadConfig(
  path = process.env.IRON_LEGION_CONFIG || join(dataHome, "config.json"),
): Config {
  const config = configSchema.parse(
    existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {},
  );
  for (const project of config.projects) {
    project.root = realpathSync(resolve(project.root));
    if (
      project.baseBranch.includes("..") ||
      project.baseBranch.endsWith(".lock")
    )
      throw new Error("Invalid base branch.");
    if (project.holdouts) {
      project.holdouts = realpathSync(resolve(project.holdouts));
      if (
        inside(project.root, project.holdouts) ||
        inside(project.holdouts, project.root)
      )
        throw new Error("Holdouts must be outside the project tree.");
    }
    if (project.isolation === "container" && !project.containerImage)
      throw new Error("Container isolation requires containerImage.");
    if (
      project.previewUrl &&
      !["http:", "https:"].includes(new URL(project.previewUrl).protocol)
    )
      throw new Error("Invalid preview URL.");
  }
  if (new Set(config.projects.map((p) => p.id)).size !== config.projects.length)
    throw new Error("Project IDs must be unique.");
  mkdirSync(dataHome, { recursive: true });
  return config;
}
