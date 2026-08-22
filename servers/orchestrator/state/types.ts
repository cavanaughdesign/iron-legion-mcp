export type RunStatus = "running" | "completed" | "failed" | "aborted";
export type StepName = "analyze" | "plan" | "edit" | "test" | "deploy";
export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";
export type MemoryKind = "decision" | "run_summary" | "note";

export interface Run {
  id: string;
  project_path: string;
  started_at: string;
  finished_at: string | null;
  status: RunStatus;
  summary: string | null;
}

export interface RunStep {
  id: string;
  run_id: string;
  step_name: StepName;
  status: StepStatus;
  started_at: string | null;
  finished_at: string | null;
  output_ref: string | null;
}

export interface Memory {
  id: string;
  run_id: string | null;
  kind: MemoryKind;
  text: string;
  created_at: string;
}

export interface MemoryRecallResult extends Memory {
  distance: number;
}
