import { readFile } from "node:fs/promises";
import path from "node:path";

export const SNAPSHOT_REQUEST_TRIGGER_CONTRACTS = [
  {
    adrPhrase: "governed output",
    skillPhrase: "governed outputs",
  },
  {
    adrPhrase: "generated-output behavior",
    skillPhrase: "generated-output behavior",
  },
  {
    adrPhrase: "schema or type contract",
    skillPhrase: "schema or type contracts",
  },
  {
    adrPhrase: "cross-agent, or cross-skill handoff behavior",
    skillPhrase: "cross-agent or cross-skill handoff behavior",
  },
  {
    adrPhrase:
      "Path-validation, filesystem-safety, or other security-sensitive behavior",
    skillPhrase:
      "path-validation, filesystem-safety, or other security-sensitive behavior",
  },
  {
    adrPhrase: "explicit controller request for audit",
    skillPhrase: "explicit controller audit",
  },
  {
    adrPhrase: "unclear classification",
    skillPhrase: "unclear classification",
  },
] as const;

export async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(process.cwd(), relativePath), "utf-8");
}

export async function readSkillSource(skillName: string): Promise<string> {
  return readRepoFile(path.join("skills", skillName, "SKILL.md"));
}

export function normalizeWhitespace(content: string): string {
  return content.replace(/\s+/g, " ").trim();
}

export function getMarkdownSection(content: string, heading: string): string {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headingPattern = new RegExp(`^## ${escapedHeading}\\s*$`, "m");
  let sectionStart: number | undefined;
  let sectionEnd = content.length;
  let offset = 0;
  let fence: MarkdownFence | undefined;

  for (const line of content.split(/(?<=\n)/)) {
    const lineText = line.replace(/\r?\n$/, "");

    if (!fence && sectionStart === undefined && headingPattern.test(lineText)) {
      sectionStart = offset;
    } else if (
      !fence &&
      sectionStart !== undefined &&
      lineText.startsWith("## ")
    ) {
      sectionEnd = offset;
      break;
    }

    fence = nextFenceState(lineText, fence);
    offset += line.length;
  }

  if (sectionStart === undefined) {
    throw new Error(`Missing markdown section: ${heading}`);
  }

  return content.slice(sectionStart, sectionEnd).trim();
}

type MarkdownFence = {
  char: "`" | "~";
  length: number;
};

function nextFenceState(
  lineText: string,
  current: MarkdownFence | undefined,
): MarkdownFence | undefined {
  const marker = parseFenceMarker(lineText);

  if (!marker) return current;

  if (!current) return marker;

  if (
    marker.char === current.char &&
    marker.length >= current.length &&
    marker.trailing.trim() === ""
  ) {
    return undefined;
  }

  return current;
}

function parseFenceMarker(
  lineText: string,
): (MarkdownFence & { trailing: string }) | undefined {
  const match = /^(?: {0,3})(`{3,}|~{3,})(.*)$/.exec(lineText);
  if (!match) return undefined;

  const marker = match[1];
  const char = marker[0] as "`" | "~";

  return {
    char,
    length: marker.length,
    trailing: match[2],
  };
}
