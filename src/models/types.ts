export interface LoadedSkill {
  name: string;
  dirPath: string;
  skillMdContent: string;
  source: import("../config/schema.js").SkillSource;
  body: string;
  subdirs: string[];
}

export interface LoadedAgent {
  name: string;
  filePath: string;
  source: import("../config/schema.js").AgentSource;
}

interface RenderedBase {
  target: "claude" | "codex";
  name: string;
  sourcePath: string;
  installedPath: string;
  contentHash: string;
}

export interface RenderedAgent extends RenderedBase {
  type: "agent";
  generatedPath: string;
  content: string;
}

export interface RenderedSkill extends RenderedBase {
  type: "skill";
  generatedPath: string;
  content: string;
}

export type RenderedOutput = RenderedAgent | RenderedSkill;

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
