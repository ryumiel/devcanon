export interface LoadedSkill {
  name: string;
  dirPath: string;
  skillMdContent: string;
  subdirs: string[];
}

export interface LoadedAgent {
  name: string;
  filePath: string;
  source: import("../config/schema.js").AgentSource;
}

export interface RenderedOutput {
  target: "claude" | "codex";
  type: "skill" | "agent";
  name: string;
  sourcePath: string;
  generatedPath: string | null;
  installedPath: string;
  content: string | null;
  contentHash: string;
}

export type PlanActionKind =
  | "install"
  | "update"
  | "skip-up-to-date"
  | "skip-conflict"
  | "force-overwrite"
  | "remove";

export interface PlanAction {
  kind: PlanActionKind;
  target: "claude" | "codex";
  type: "skill" | "agent";
  name: string;
  sourcePath: string;
  generatedPath: string | null;
  installedPath: string;
  contentHash: string;
  reason: string;
}

export interface SyncOptions {
  target?: "claude" | "codex";
  mode?: "symlink" | "copy";
  dryRun: boolean;
  force: boolean;
  strict: boolean;
}

export type DiffStatus =
  | "added"
  | "removed"
  | "changed"
  | "up-to-date"
  | "unmanaged-conflict";

export interface DiffResult {
  status: DiffStatus;
  target: "claude" | "codex";
  type: "skill" | "agent";
  name: string;
  installedPath: string;
  diff: string | null;
}
