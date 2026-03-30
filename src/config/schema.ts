import { z } from "zod";

// --- Install mode ---
export const InstallModeSchema = z.enum(["symlink", "copy"]);
export type InstallMode = z.infer<typeof InstallModeSchema>;

// --- Overwrite policy ---
export const OverwritePolicySchema = z.enum([
  "skip-existing",
  "overwrite-managed",
  "overwrite-all",
]);
export type OverwritePolicy = z.infer<typeof OverwritePolicySchema>;

// --- Target config ---
const TargetConfigSchema = z.object({
  enabled: z.boolean().default(true),
  skillsHome: z.string(),
  agentsHome: z.string(),
  installMode: InstallModeSchema.optional(),
});

// --- Main config ---
export const ConfigSchema = z.object({
  version: z.literal(1),
  library: z
    .object({
      skillsDir: z.string().default("./skills"),
      agentsDir: z.string().default("./agents"),
      generatedDir: z.string().default("./generated"),
    })
    .default({}),
  targets: z
    .object({
      claude: TargetConfigSchema.default({
        enabled: true,
        skillsHome: "~/.claude/skills",
        agentsHome: "~/.claude/agents",
      }),
      codex: TargetConfigSchema.default({
        enabled: true,
        skillsHome: "~/.agents/skills",
        agentsHome: "~/.codex/agents",
      }),
    })
    .default({}),
  defaults: z
    .object({
      installMode: InstallModeSchema.default("symlink"),
      overwritePolicy: OverwritePolicySchema.default("overwrite-managed"),
      cleanManagedOutputs: z.boolean().default(true),
    })
    .default({}),
  platform: z
    .object({
      windowsSymlinkFallback: InstallModeSchema.default("copy"),
    })
    .default({}),
  manifest: z
    .object({
      path: z.string().default("~/.agents-manager/manifest.json"),
    })
    .default({}),
});

export type Config = z.infer<typeof ConfigSchema>;

// --- Resolved config (all paths absolute) ---
export interface ResolvedConfig {
  configDir: string;
  library: {
    skillsDir: string;
    agentsDir: string;
    generatedDir: string;
  };
  targets: {
    claude: ResolvedTargetConfig;
    codex: ResolvedTargetConfig;
  };
  defaults: {
    installMode: InstallMode;
    overwritePolicy: OverwritePolicy;
    cleanManagedOutputs: boolean;
  };
  platform: {
    windowsSymlinkFallback: InstallMode;
  };
  manifest: {
    path: string;
  };
}

export interface ResolvedTargetConfig {
  enabled: boolean;
  skillsHome: string;
  agentsHome: string;
  installMode: InstallMode;
}

// --- Agent source ---
const FILESYSTEM_SAFE = /^[a-z0-9][a-z0-9._-]*$/;

const ClaudeTargetSchema = z
  .object({
    model: z.string().optional(),
    tools: z.array(z.string()).optional(),
  })
  .passthrough();

const CodexTargetSchema = z
  .object({
    model: z.string().optional(),
    model_reasoning_effort: z.string().optional(),
    sandbox_mode: z
      .enum(["read-only", "workspace-write", "danger-full-access"])
      .optional(),
    nickname_candidates: z.array(z.string()).optional(),
    approval_policy: z.string().optional(),
  })
  .passthrough();

export const AgentSourceSchema = z.object({
  name: z
    .string()
    .regex(
      FILESYSTEM_SAFE,
      "Must be filesystem-safe (lowercase, alphanumeric, hyphens, dots, underscores)",
    ),
  description: z.string().min(1),
  instructions: z.string().min(1),
  skills: z.array(z.string()).default([]),
  claude: ClaudeTargetSchema.optional(),
  codex: CodexTargetSchema.optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

export type AgentSource = z.infer<typeof AgentSourceSchema>;

// --- Manifest ---
const ManagedRecordSchema = z.object({
  target: z.enum(["claude", "codex"]),
  type: z.enum(["skill", "agent"]),
  sourcePath: z.string(),
  generatedPath: z.string().nullable(),
  installedPath: z.string(),
  installMode: InstallModeSchema,
  contentHash: z.string(),
  timestamp: z.string(),
});

export type ManagedRecord = z.infer<typeof ManagedRecordSchema>;

export const ManifestSchema = z.object({
  version: z.literal(1),
  managedBy: z.literal("agents-manager"),
  lastSync: z.string(),
  records: z.array(ManagedRecordSchema),
});

export type Manifest = z.infer<typeof ManifestSchema>;
