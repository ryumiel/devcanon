import { CONFIG_FILE_NAME } from "../config/identity.js";
import {
  type CapabilityProfiles,
  CapabilitySchema,
  type FileArtifacts,
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
const ACTIVE_MODEL_PLACEHOLDER = /(?<!\\)\{\{model:([^{}\r\n]*)\}\}/g;
const SHARED_PLACEHOLDER_VALUE = /^[\w-]+$/;
export { collectProseSegments } from "../utils/markdown-prose.js";

export interface PlaceholderGlossary {
  model: CapabilityProfiles;
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
  model: "capabilityProfiles",
  tool: "toolNames",
  file: "fileArtifacts",
};

const NAMESPACE_KEY_FORMAT: Record<
  Exclude<SupportedNamespace, "model">,
  RegExp
> = {
  tool: PLACEHOLDER_KEY,
  file: PLACEHOLDER_KEY,
};

function isSupportedNamespace(value: string): value is SupportedNamespace {
  return (SUPPORTED_NAMESPACES as readonly string[]).includes(value);
}

export function buildGlossary(config: ResolvedConfig): PlaceholderGlossary {
  return {
    model: config.capabilityProfiles,
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
  validateMalformedModelPlaceholders(line, context);
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
    if (namespace === "model") {
      return resolveModelPlaceholder(value, target, glossary.model, context);
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
        `${configKey} not configured — define ${configKey} in ${CONFIG_FILE_NAME}`,
        context,
      );
    }
    // Object.hasOwn guards against prototype-chain keys such as
    // "constructor" resolving to Object.prototype and bypassing the
    // unknown-key check.
    if (!Object.hasOwn(dict, value)) {
      throw renderError(
        `unknown ${namespace} key "${value}" — define it under ${configKey} in config`,
        context,
      );
    }
    return (dict as ToolNames | FileArtifacts)[value][target];
  });
}

function validateMalformedModelPlaceholders(
  line: string,
  context: PlaceholderRenderContext | undefined,
): void {
  for (const match of line.matchAll(ACTIVE_MODEL_PLACEHOLDER)) {
    const value = match[1];
    if (SHARED_PLACEHOLDER_VALUE.test(value)) continue;
    throw unsupportedModelPlaceholderError(value, context);
  }
}

function resolveModelPlaceholder(
  value: string,
  target: "claude" | "codex",
  profiles: CapabilityProfiles,
  context: PlaceholderRenderContext | undefined,
): string {
  const capability = CapabilitySchema.safeParse(value);
  if (!capability.success || !Object.hasOwn(profiles, capability.data)) {
    throw unsupportedModelPlaceholderError(value, context);
  }

  return profiles[capability.data][target];
}

function unsupportedModelPlaceholderError(
  value: string,
  context: PlaceholderRenderContext | undefined,
): Error {
  const token = `{{model:${value}}}`;
  const supported = CapabilitySchema.options
    .map((capability) => `{{model:${capability}}}`)
    .join(", ");
  return renderError(
    `unsupported model capability "${value}" in token "${token}" — use ${supported}; the ${NAMESPACE_CONFIG_KEY.model} catalog in ${CONFIG_FILE_NAME} defines the target model strings`,
    context,
  );
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
  return `${namespace} keys must match /^[a-z0-9][a-z0-9-]*$/ (lowercase, digits, hyphens)`;
}
