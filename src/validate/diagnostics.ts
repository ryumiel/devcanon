export type ValidationDiagnosticCode =
  | "skill.prompt-size"
  | "skill.drift-token"
  | "skill.stray-file";

export type ValidationDiagnosticArea = "skill";

export type ValidationDiagnosticStrictBehavior = "advisory" | "strictable";

export interface ValidationDiagnostic {
  code: ValidationDiagnosticCode;
  area: ValidationDiagnosticArea;
  subject: string;
  strictBehavior: ValidationDiagnosticStrictBehavior;
  summary: string;
  details?: string[];
  metrics?: Record<string, number | string>;
  hint?: string;
}

export type ValidationDiagnosticReporter = (
  diagnostic: ValidationDiagnostic,
) => void;

export function formatValidationDiagnostic(
  diagnostic: ValidationDiagnostic,
): string {
  switch (diagnostic.code) {
    case "skill.prompt-size":
      return formatPromptSizeDiagnostic(diagnostic);
    case "skill.drift-token":
      return formatDriftTokenDiagnostic(diagnostic);
    case "skill.stray-file":
      return formatStrayFileDiagnostic(diagnostic);
    default: {
      const _exhaustive: never = diagnostic.code;
      throw new Error(`unhandled validation diagnostic: ${_exhaustive}`);
    }
  }
}

function formatPromptSizeDiagnostic(diagnostic: ValidationDiagnostic): string {
  return [
    `Skill "${diagnostic.subject}": ${diagnostic.summary}`,
    diagnostic.details?.[0],
    diagnostic.hint,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" ");
}

function formatDriftTokenDiagnostic(diagnostic: ValidationDiagnostic): string {
  if (!diagnostic.hint) {
    return `Skill "${diagnostic.subject}": ${diagnostic.summary}.`;
  }
  return `Skill "${diagnostic.subject}": ${diagnostic.summary}; ${lowercaseFirst(
    diagnostic.hint,
  )}`;
}

function formatStrayFileDiagnostic(diagnostic: ValidationDiagnostic): string {
  if (!diagnostic.hint) {
    return `Skill "${diagnostic.subject}": ${diagnostic.summary}.`;
  }
  return `Skill "${diagnostic.subject}": ${diagnostic.summary} — ${diagnostic.hint}`;
}

function lowercaseFirst(input: string): string {
  return `${input.charAt(0).toLocaleLowerCase("en-US")}${input.slice(1)}`;
}
