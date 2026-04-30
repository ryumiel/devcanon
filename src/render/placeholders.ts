import type {
  FileArtifacts,
  ModelTiers,
  ResolvedConfig,
  ToolNames,
} from "../config/schema.js";
import {
  collectProseSegments,
  visitMarkdownLines,
} from "../utils/markdown-prose.js";

/**
 * Matches an optional escape (`\`) followed by `{{namespace:value}}`.
 * Namespace uses `\w+` (letters, digits, underscore).
 * Value uses `[\w-]+` to support kebab-case keys (e.g. `task-tracker`).
 */
const PLACEHOLDER = /(\\)?\{\{(\w+):([\w-]+)\}\}/g;
export { collectProseSegments } from "../utils/markdown-prose.js";

export interface PlaceholderGlossary {
  model?: ModelTiers;
  tool?: ToolNames;
  file?: FileArtifacts;
}

const SUPPORTED_NAMESPACES = ["model", "tool", "file"] as const;
type SupportedNamespace = (typeof SUPPORTED_NAMESPACES)[number];

const NAMESPACE_CONFIG_KEY: Record<SupportedNamespace, string> = {
  model: "modelTiers",
  tool: "toolNames",
  file: "fileArtifacts",
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
): string {
  const out: string[] = [];

  visitMarkdownLines(input, {
    onProseLine: (line) => {
      out.push(substituteLine(line, target, glossary));
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
): string {
  return line.replace(PLACEHOLDER, (_match, esc, namespace, value) => {
    if (esc) {
      return `{{${namespace}:${value}}}`;
    }
    if (!isSupportedNamespace(namespace)) {
      throw new Error(
        `Unknown placeholder namespace "${namespace}" — supported: ${SUPPORTED_NAMESPACES.join(", ")}`,
      );
    }
    const configKey = NAMESPACE_CONFIG_KEY[namespace];
    const dict = glossary[namespace];
    if (!dict) {
      throw new Error(
        `${configKey} not configured — define ${configKey} in agents-manager.config.yaml`,
      );
    }
    const entry = dict[value];
    if (!entry) {
      throw new Error(
        `Unknown ${namespace} key "${value}" — define it under ${configKey} in config`,
      );
    }
    return entry[target];
  });
}
