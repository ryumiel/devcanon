import path from "node:path";
import { CODEX_TARGET_FIELDS, type ResolvedConfig } from "../config/schema.js";
import type {
  LoadedAgent,
  LoadedSkill,
  RenderedAgent,
} from "../models/types.js";
import { UserError } from "../utils/errors.js";
import { sha256 } from "../utils/hash.js";
import { resolveCapabilityModel } from "./capability-profiles.js";
import {
  SAFE_PASSTHROUGH_KEY,
  describeValueShape,
  isFiniteNumber,
  isHomogeneousScalarArray,
  sortedUnknownEntries,
  warnPassthroughSkip,
} from "./passthrough.js";

/** TOML 1.0 basic-string short escapes. */
const TOML_SHORT_ESCAPES: Readonly<Record<string, string>> = Object.freeze({
  "\b": "\\b",
  "\t": "\\t",
  "\n": "\\n",
  "\f": "\\f",
  "\r": "\\r",
});

// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — TOML 1.0 requires escaping these control chars.
const TOML_ESCAPE_REQUIRED = /[\x00-\x1F\x7F]/g;

function toUnicodeEscape(ch: string): string {
  return `\\u${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`;
}

/**
 * TOML 1.0 basic-string quoter. Assumes well-formed Unicode input: lone
 * surrogate code units are passed through unchanged, and the caller owns
 * string validity (the quoter does not enforce scalar-value-only inputs).
 * @internal Not suitable for multi-line or literal strings.
 */
export function tomlQuote(s: string): string {
  const escaped = s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(
      TOML_ESCAPE_REQUIRED,
      (ch) => TOML_SHORT_ESCAPES[ch] ?? toUnicodeEscape(ch),
    );
  return `"${escaped}"`;
}

/**
 * TOML 1.0 multi-line basic-string quoter. Returns the fully-delimited
 * `"""\n<body>\n"""` form. Literal LF is preserved; TAB is passed through
 * raw; bare CR (not part of CRLF) is escaped to `\r`; runs of three or
 * more `"` are broken so they cannot terminate the string; other C0
 * controls and DEL are escaped via short escapes or `\uXXXX`.
 * @internal Not suitable for single-line or literal strings.
 */
export function tomlQuoteMultilineBasic(s: string): string {
  const escaped = s
    .replace(/\\/g, "\\\\")
    .replace(/"""/g, '""\\"')
    .replace(/\r(?!\n)/g, "\\r")
    .replace(TOML_ESCAPE_REQUIRED, (ch) => {
      if (ch === "\t" || ch === "\n" || ch === "\r") return ch;
      return TOML_SHORT_ESCAPES[ch] ?? toUnicodeEscape(ch);
    });
  return `"""\n${escaped}\n"""`;
}

function renderGranularApprovalPolicy(
  granular: Record<string, boolean | undefined>,
): string {
  const fields = [
    "mcp_elicitations",
    "request_permissions",
    "rules",
    "sandbox_approval",
    "skill_approval",
  ]
    .flatMap((field) =>
      granular[field] === undefined ? [] : [`${field} = ${granular[field]}`],
    )
    .join(", ");

  return `approval_policy = { granular = { ${fields} } }`;
}

/**
 * Emit one TOML assignment for an unknown Codex field, or `null` when the
 * value or key is not safely renderable. TOML has no null (null values are
 * skipped with a warning). Inline tables are deferred — the only known
 * inline-table field (`approval_policy.granular`) has dedicated rendering
 * and a generic emitter would require recursive key quoting well beyond the
 * scope of forward-compat passthrough.
 */
function renderCodexPassthroughLine(
  key: string,
  value: unknown,
  agentName: string,
): string | null {
  if (!SAFE_PASSTHROUGH_KEY.test(key)) {
    warnPassthroughSkip(
      "codex",
      agentName,
      key,
      `key must match ${SAFE_PASSTHROUGH_KEY}`,
    );
    return null;
  }

  if (value === undefined) return null;

  if (value === null) {
    warnPassthroughSkip(
      "codex",
      agentName,
      key,
      "TOML has no null representation",
    );
    return null;
  }

  if (typeof value === "string") return `${key} = ${tomlQuote(value)}`;
  if (typeof value === "boolean") return `${key} = ${String(value)}`;
  if (isFiniteNumber(value)) return `${key} = ${String(value)}`;

  if (isHomogeneousScalarArray(value)) {
    const items = value.map((item) =>
      typeof item === "string" ? tomlQuote(item) : String(item),
    );
    return `${key} = [${items.join(", ")}]`;
  }

  warnPassthroughSkip(
    "codex",
    agentName,
    key,
    `unsupported value shape: ${describeValueShape(value)}`,
  );
  return null;
}

export function renderCodexAgent(
  agent: LoadedAgent,
  skills: Map<string, LoadedSkill>,
  config: ResolvedConfig,
): RenderedAgent {
  const lines: string[] = [];

  // Required fields
  lines.push(`name = ${tomlQuote(agent.source.name)}`);
  lines.push(`description = ${tomlQuote(agent.source.description)}`);

  // Optional codex-specific fields
  const codex = agent.source.codex;
  if (codex?.model?.includes("{{model:")) {
    throw new UserError(
      `Agent "${agent.name}": codex.model no longer supports model placeholders (received "${codex.model}"); set top-level capability to efficient, balanced, or frontier, or use a literal target model.`,
      agent.filePath,
    );
  }

  const model = resolveCapabilityModel(
    codex?.model,
    agent.source.capability,
    "codex",
    config.capabilityProfiles,
  );
  if (model) lines.push(`model = ${tomlQuote(model)}`);

  if (codex) {
    const modelReasoningEffort = codex.model_reasoning_effort;
    if (modelReasoningEffort)
      lines.push(`model_reasoning_effort = ${tomlQuote(modelReasoningEffort)}`);
    if (codex.sandbox_mode)
      lines.push(`sandbox_mode = ${tomlQuote(codex.sandbox_mode)}`);
    if (codex.nickname_candidates?.length) {
      const items = codex.nickname_candidates.map(tomlQuote).join(", ");
      lines.push(`nickname_candidates = [${items}]`);
    }
    if (codex.approval_policy) {
      if (typeof codex.approval_policy === "string") {
        lines.push(`approval_policy = ${tomlQuote(codex.approval_policy)}`);
      } else {
        lines.push(
          renderGranularApprovalPolicy(codex.approval_policy.granular),
        );
      }
    }

    for (const [key, value] of sortedUnknownEntries(
      codex as Record<string, unknown>,
      CODEX_TARGET_FIELDS,
    )) {
      const line = renderCodexPassthroughLine(key, value, agent.name);
      if (line !== null) lines.push(line);
    }
  }

  // Build developer_instructions
  let instrContent = agent.source.instructions.trimEnd();

  const agentSkills = agent.source.skills;
  if (agentSkills.length > 0) {
    instrContent += "\n\n## Skills\n";
    for (const skillName of agentSkills) {
      const installPath = path
        .join(config.targets.codex.skillsHome, skillName)
        .replaceAll("\\", "/");
      instrContent += `\n- **${skillName}** (\`${installPath}\`)`;
    }
  }

  lines.push("");
  lines.push(
    `developer_instructions = ${tomlQuoteMultilineBasic(instrContent)}`,
  );
  lines.push("");

  const content = lines.join("\n");
  return {
    target: "codex",
    type: "agent",
    name: agent.name,
    sourcePath: agent.filePath,
    generatedPath: path.join(
      config.library.generatedDir,
      "codex",
      "agents",
      `${agent.name}.toml`,
    ),
    installedPath: path.join(
      config.targets.codex.agentsHome,
      `${agent.name}.toml`,
    ),
    content,
    contentHash: sha256(content),
  };
}
