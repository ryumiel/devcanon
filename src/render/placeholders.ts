import {
  type FileArtifacts,
  MODEL_TIER_KEY,
  type ModelTiers,
  PLACEHOLDER_KEY,
  type ResolvedConfig,
  type ToolNames,
} from "../config/schema.js";
import { visitMarkdownLines } from "../utils/markdown-prose.js";

/**
 * Matches an optional escape (`\`) followed by `{{namespace:value}}`.
 * Namespace uses `\w+` (letters, digits, underscore).
 * Value uses `[\w-]+` to support kebab-case keys (e.g. `task-tracker`).
 * The captured key is then re-validated per-namespace against the stricter
 * config-time format in `substituteLine`, so e.g. `{{tool:taskTracker}}`
 * yields a clear "invalid key" error instead of "unknown key".
 */
const PLACEHOLDER = /(\\)?\{\{(\w+):([\w-]+)\}\}/g;
export { collectProseSegments } from "../utils/markdown-prose.js";

export interface PlaceholderGlossary {
  model?: ModelTiers;
  tool?: ToolNames;
  file?: FileArtifacts;
}

export interface PlaceholderRenderContext {
  skillName: string;
  target: "claude" | "codex";
}

const SUPPORTED_NAMESPACES = ["model", "tool", "file"] as const;
type SupportedNamespace = (typeof SUPPORTED_NAMESPACES)[number];

const NAMESPACE_CONFIG_KEY: Record<SupportedNamespace, string> = {
  model: "modelTiers",
  tool: "toolNames",
  file: "fileArtifacts",
};

const NAMESPACE_KEY_FORMAT: Record<SupportedNamespace, RegExp> = {
  model: MODEL_TIER_KEY,
  tool: PLACEHOLDER_KEY,
  file: PLACEHOLDER_KEY,
};

function isSupportedNamespace(value: string): value is SupportedNamespace {
  return (SUPPORTED_NAMESPACES as readonly string[]).includes(value);
}

export function buildGlossary(config: ResolvedConfig): PlaceholderGlossary {
  return {
    model: config.modelTiers,
    tool: config.toolNames,
    file: config.fileArtifacts,
  };
}

export function resolvePlaceholders(
  input: string,
  target: "claude" | "codex",
  glossary: PlaceholderGlossary,
  context?: PlaceholderRenderContext,
): string {
  const out: string[] = [];

  visitMarkdownLines(input, {
    onProseLine: (line) => {
      out.push(substituteLine(line, target, glossary, context));
    },
    onFenceLine: (line) => {
      out.push(line);
    },
    onCodeLine: (line) => {
      out.push(line);
    },
  });

  return out.join("\n");
}

function substituteLine(
  line: string,
  target: "claude" | "codex",
  glossary: PlaceholderGlossary,
  context: PlaceholderRenderContext | undefined,
): string {
  return line.replace(PLACEHOLDER, (_match, esc, namespace, value) => {
    if (esc) {
      return `{{${namespace}:${value}}}`;
    }
    if (!isSupportedNamespace(namespace)) {
      throw renderError(
        `unknown placeholder namespace "${namespace}" — supported: ${SUPPORTED_NAMESPACES.join(", ")}`,
        context,
      );
    }
    if (!NAMESPACE_KEY_FORMAT[namespace].test(value)) {
      throw renderError(
        `invalid ${namespace} placeholder key "${value}" — ${formatKeyHint(namespace)}`,
        context,
      );
    }
    const configKey = NAMESPACE_CONFIG_KEY[namespace];
    const dict = glossary[namespace];
    if (!dict) {
      throw renderError(
        `${configKey} not configured — define ${configKey} in agents-manager.config.yaml`,
        context,
      );
    }
    // Object.hasOwn guards against prototype-chain keys such as
    // "constructor" resolving to Object.prototype and bypassing the
    // unknown-key check.
    if (!Object.hasOwn(dict, value)) {
      const subject = namespace === "model" ? "model tier" : `${namespace} key`;
      throw renderError(
        `unknown ${subject} "${value}" — define it under ${configKey} in config`,
        context,
      );
    }
    if (namespace === "model") {
      return (dict as ModelTiers)[value][target].model;
    }
    return (dict as ToolNames | FileArtifacts)[value][target];
  });
}

function renderError(
  message: string,
  context: PlaceholderRenderContext | undefined,
): Error {
  if (!context) return new Error(message);
  return new Error(
    `Skill "${context.skillName}" (${context.target}): ${message}`,
  );
}

function formatKeyHint(namespace: SupportedNamespace): string {
  if (namespace === "model") {
    return "model tier keys must match /^\\w+$/ (letters, digits, underscores)";
  }
  return `${namespace} keys must match /^[a-z0-9][a-z0-9-]*$/ (lowercase, digits, hyphens)`;
}
