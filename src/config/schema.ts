import { z } from "zod";
import { FILESYSTEM_SAFE } from "../utils/naming.js";

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

// --- Target entries (shared shape for model/tool/file glossaries) ---
// Values are bounded so that drift-detection regexes built from them stay
// inside V8's RegExp-source size limit; a token over ~50 KB would otherwise
// throw SyntaxError at `RegExp.test` time under the `u` flag.
const TARGET_ENTRY_VALUE_MAX = 256;

const TargetEntrySchema = z.object({
  claude: z.string().min(1).max(TARGET_ENTRY_VALUE_MAX),
  codex: z.string().min(1).max(TARGET_ENTRY_VALUE_MAX),
});

const MODEL_TIER_KEY = /^\w+$/;
const PLACEHOLDER_KEY = /^[a-z0-9][a-z0-9-]*$/;

export const ModelTiersSchema = z
  .record(z.string(), TargetEntrySchema)
  .superRefine((tiers, ctx) => {
    if (Object.keys(tiers).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "modelTiers must define at least one tier",
      });
      return;
    }
    for (const key of Object.keys(tiers)) {
      if (!MODEL_TIER_KEY.test(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Model tier name "${key}" must match /^\\w+$/ (letters, digits, underscore)`,
          path: [key],
        });
      }
    }
  });

export type ModelTiers = z.infer<typeof ModelTiersSchema>;

function makePlaceholderGlossarySchema(
  semanticName: "tool name" | "file artifact",
  configKey: "toolNames" | "fileArtifacts",
) {
  return z.record(z.string(), TargetEntrySchema).superRefine((entries, ctx) => {
    if (Object.keys(entries).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${configKey} must define at least one entry`,
      });
      return;
    }
    for (const key of Object.keys(entries)) {
      if (!PLACEHOLDER_KEY.test(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${semanticName} "${key}" must match /^[a-z0-9][a-z0-9-]*$/ (lowercase, digits, hyphens)`,
          path: [key],
        });
      }
    }
  });
}

export const ToolNamesSchema = makePlaceholderGlossarySchema(
  "tool name",
  "toolNames",
);
export const FileArtifactsSchema = makePlaceholderGlossarySchema(
  "file artifact",
  "fileArtifacts",
);

export type ToolNames = z.infer<typeof ToolNamesSchema>;
export type FileArtifacts = z.infer<typeof FileArtifactsSchema>;

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
  modelTiers: ModelTiersSchema.optional(),
  toolNames: ToolNamesSchema.optional(),
  fileArtifacts: FileArtifactsSchema.optional(),
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
  modelTiers?: ModelTiers;
  toolNames?: ToolNames;
  fileArtifacts?: FileArtifacts;
}

export interface ResolvedTargetConfig {
  enabled: boolean;
  skillsHome: string;
  agentsHome: string;
  installMode: InstallMode;
}

// --- Agent source ---
const ClaudeTargetShape = {
  model: z.string().optional(),
  tools: z.array(z.string()).optional(),
};

const NICKNAME_CANDIDATE = /^[A-Za-z0-9 _-]+$/;

const NicknameCandidatesSchema = z
  .array(z.string())
  .nonempty("Nickname candidates must be a non-empty list")
  .superRefine((candidates, ctx) => {
    const seen = new Set<string>();

    for (const [index, candidate] of candidates.entries()) {
      const normalized = candidate.trim();
      if (normalized.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Nickname candidates cannot contain blank names",
          path: [index],
        });
        continue;
      }

      if (!NICKNAME_CANDIDATE.test(normalized)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Nickname candidates may only use ASCII letters, digits, spaces, hyphens, and underscores",
          path: [index],
        });
      }

      if (seen.has(normalized)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Nickname candidates must be unique",
          path: [index],
        });
        continue;
      }

      seen.add(normalized);
    }
  })
  .transform((candidates) => candidates.map((candidate) => candidate.trim()));

const CodexApprovalPolicyGranularShape = {
  mcp_elicitations: z.boolean(),
  request_permissions: z.boolean().optional(),
  rules: z.boolean(),
  sandbox_approval: z.boolean(),
  skill_approval: z.boolean().optional(),
};

const CodexApprovalPolicyShape = {
  granular: z.object(CodexApprovalPolicyGranularShape),
};

const CodexApprovalPolicySchema = z.union([
  z.enum(["untrusted", "on-request", "on-failure", "never"]),
  z.object(CodexApprovalPolicyShape),
]);

const CodexTargetShape = {
  model: z.string().optional(),
  model_reasoning_effort: z
    .enum(["none", "minimal", "low", "medium", "high", "xhigh"])
    .optional(),
  sandbox_mode: z
    .enum(["read-only", "workspace-write", "danger-full-access"])
    .optional(),
  nickname_candidates: NicknameCandidatesSchema.optional(),
  approval_policy: CodexApprovalPolicySchema.optional(),
};

export const CLAUDE_TARGET_FIELDS = Object.keys(ClaudeTargetShape) as Array<
  keyof typeof ClaudeTargetShape
>;
export const CODEX_APPROVAL_POLICY_FIELDS = Object.keys(
  CodexApprovalPolicyShape,
) as Array<keyof typeof CodexApprovalPolicyShape>;
export const CODEX_APPROVAL_POLICY_GRANULAR_FIELDS = Object.keys(
  CodexApprovalPolicyGranularShape,
) as Array<keyof typeof CodexApprovalPolicyGranularShape>;
export const CODEX_TARGET_FIELDS = Object.keys(CodexTargetShape) as Array<
  keyof typeof CodexTargetShape
>;

// Extra keys flow through to renderers for forward compatibility with
// upstream target fields the schema has not yet adopted. Typo detection
// happens in `collectUnknownFields` (src/validate/agents.ts), not here.
const ClaudeTargetSchema = z.object(ClaudeTargetShape).passthrough();

const CodexTargetSchema = z.object(CodexTargetShape).passthrough();

const AgentSourceShape = {
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
};

export const AGENT_SOURCE_FIELDS = Object.keys(AgentSourceShape) as Array<
  keyof typeof AgentSourceShape
>;

export const AgentSourceSchema = z.object(AgentSourceShape);

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

// --- Skill source ---
const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;

const AllowedToolsSchema = z.union([
  z.string().min(1),
  z.array(z.string().min(1)).min(1),
]);

const ClaudeSkillOverrideShape = {
  model: z.string().optional(),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
  when_to_use: z.string().optional(),
  "argument-hint": z.string().optional(),
  arguments: z.union([z.string(), z.array(z.string())]).optional(),
  "disable-model-invocation": z.boolean().optional(),
  "user-invocable": z.boolean().optional(),
  context: z.string().optional(),
  agent: z.string().optional(),
  paths: z.array(z.string()).optional(),
  shell: z.enum(["bash", "powershell"]).optional(),
};

export const CLAUDE_SKILL_OVERRIDE_FIELDS = Object.keys(
  ClaudeSkillOverrideShape,
) as Array<keyof typeof ClaudeSkillOverrideShape>;

const ClaudeSkillOverrideSchema = z.object(ClaudeSkillOverrideShape).strict();

const CodexSkillOverrideShape = {
  license: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
};

export const CODEX_SKILL_OVERRIDE_FIELDS = Object.keys(
  CodexSkillOverrideShape,
) as Array<keyof typeof CodexSkillOverrideShape>;

const CodexSkillOverrideSchema = z.object(CodexSkillOverrideShape).strict();

const CodexSidecarShape = {
  interface: z
    .object({
      display_name: z.string().optional(),
      short_description: z.string().optional(),
      icon_small: z.string().optional(),
      icon_large: z.string().optional(),
      brand_color: z.string().optional(),
      default_prompt: z.string().optional(),
    })
    .strict()
    .optional(),
  policy: z
    .object({
      allow_implicit_invocation: z.boolean().optional(),
    })
    .strict()
    .optional(),
  dependencies: z
    .object({
      tools: z.array(z.string()).optional(),
    })
    .strict()
    .optional(),
};

const CodexSidecarSchema = z.object(CodexSidecarShape).strict();

const SkillSourceShape = {
  name: z
    .string()
    .regex(SKILL_NAME, "Must match /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/")
    .max(64),
  description: z
    .string()
    .min(1)
    .max(1024)
    .refine((v) => !/[<>]/.test(v), {
      message: "description must not contain '<' or '>'",
    }),
  "allowed-tools": AllowedToolsSchema.optional(),
  claude: ClaudeSkillOverrideSchema.optional(),
  codex: CodexSkillOverrideSchema.optional(),
  codex_sidecar: CodexSidecarSchema.optional(),
};

export const SKILL_SOURCE_FIELDS = Object.keys(SkillSourceShape) as Array<
  keyof typeof SkillSourceShape
>;

export const SkillSourceSchema = z.object(SkillSourceShape).strict();

export type SkillSource = z.infer<typeof SkillSourceSchema>;
