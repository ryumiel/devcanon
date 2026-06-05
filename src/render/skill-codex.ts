import { stringify as yamlStringify } from "yaml";
import type { PlaceholderGlossary } from "./placeholders.js";
import { resolvePlaceholders } from "./placeholders.js";
import { SHARED_KEY_ORDER, type SkillInput } from "./skill-shared.js";

export type { SkillInput } from "./skill-shared.js";

export interface RenderedCodexSkill {
  skillMd: string;
  sidecar: string | null;
}

export interface RenderCodexSkillOptions {
  displayNameSuffix?: string;
}

export function renderCodexSkill(
  input: SkillInput,
  glossary: PlaceholderGlossary,
  options: RenderCodexSkillOptions = {},
): RenderedCodexSkill {
  const { source, body } = input;
  const renderContext = { skillName: source.name, target: "codex" as const };

  const frontmatter: Record<string, unknown> = {};
  for (const key of SHARED_KEY_ORDER) {
    const value = source[key];
    if (value === undefined) continue;
    if (key === "allowed-tools" && Array.isArray(value)) {
      frontmatter[key] = value.join(" ");
    } else {
      frontmatter[key] = value;
    }
  }

  // Only top-level codex override strings are placeholder-substituted.
  // Nested values (e.g. metadata sub-keys) pass through as-is.
  if (source.codex) {
    const sortedKeys = Object.keys(source.codex).sort();
    for (const key of sortedKeys) {
      const value = (source.codex as Record<string, unknown>)[key];
      frontmatter[key] =
        typeof value === "string"
          ? resolvePlaceholders(value, "codex", glossary, renderContext)
          : value;
    }
  }

  const yaml = yamlStringify(frontmatter, { lineWidth: 0 });
  const renderedBody = resolvePlaceholders(
    body,
    "codex",
    glossary,
    renderContext,
  );

  const skillMd = `---\n${yaml}---\n${renderedBody}`;

  const sidecarSource = buildCodexSidecar(
    source.name,
    source.codex_sidecar,
    options.displayNameSuffix,
  );
  const sidecar = sidecarSource
    ? yamlStringify(sidecarSource, { lineWidth: 0 })
    : null;

  return { skillMd, sidecar };
}

type CodexSidecar = NonNullable<SkillInput["source"]["codex_sidecar"]>;
type CodexSidecarInterface = NonNullable<CodexSidecar["interface"]>;

const DISPLAY_NAME_TOKEN_OVERRIDES: Record<string, string> = {
  afds: "AFDS",
  cli: "CLI",
  git: "Git",
  github: "GitHub",
  pr: "PR",
  tdd: "TDD",
  ui: "UI",
} as const;

function buildCodexSidecar(
  skillName: string,
  sourceSidecar: CodexSidecar | undefined,
  displayNameSuffix: string | undefined,
): CodexSidecar | null {
  const normalizedSuffix = displayNameSuffix?.trim();
  if (!normalizedSuffix) return sourceSidecar ?? null;

  const displayNameBase =
    sourceSidecar?.interface?.display_name ?? skillNameToDisplayName(skillName);
  const nextInterface: CodexSidecarInterface = {
    ...sourceSidecar?.interface,
    display_name: appendDisplaySuffix(displayNameBase, normalizedSuffix),
  };
  const nextSidecar: CodexSidecar = { interface: nextInterface };

  if (sourceSidecar?.policy !== undefined) {
    nextSidecar.policy = sourceSidecar.policy;
  }
  if (sourceSidecar?.dependencies !== undefined) {
    nextSidecar.dependencies = sourceSidecar.dependencies;
  }

  return nextSidecar;
}

function appendDisplaySuffix(displayName: string, suffix: string): string {
  const formattedSuffix = ` (${suffix})`;
  if (displayName.endsWith(formattedSuffix)) return displayName;
  return `${displayName}${formattedSuffix}`;
}

function skillNameToDisplayName(skillName: string): string {
  return skillName.split("-").map(formatDisplayNameToken).join(" ");
}

function formatDisplayNameToken(token: string): string {
  const override = DISPLAY_NAME_TOKEN_OVERRIDES[token];
  if (override !== undefined) return override;
  return `${token.charAt(0).toUpperCase()}${token.slice(1)}`;
}
