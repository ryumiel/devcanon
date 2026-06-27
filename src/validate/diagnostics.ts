export type ValidationDiagnosticCode =
  | "skill.prompt-size"
  | "skill.drift-token"
  | "skill.stray-file"
  | "skill.unknown-subdir";

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

export function formatValidationDiagnosticReport(
  diagnostics: readonly ValidationDiagnostic[],
): string[] {
  if (diagnostics.length === 0) return [];

  return [
    `Warnings (${diagnostics.length})`,
    "",
    ...diagnostics.flatMap((diagnostic, index) => [
      ...formatValidationDiagnosticBlock(diagnostic),
      ...(index === diagnostics.length - 1 ? [] : [""]),
    ]),
  ];
}

export function formatValidationDiagnostic(
  diagnostic: ValidationDiagnostic,
): string {
  switch (diagnostic.code) {
    case "skill.prompt-size":
      return formatPromptSizeDiagnostic(diagnostic);
    case "skill.drift-token":
      return formatDriftTokenDiagnostic(diagnostic);
    case "skill.stray-file":
    case "skill.unknown-subdir":
      return formatStrayFileDiagnostic(diagnostic);
    default: {
      const _exhaustive: never = diagnostic.code;
      throw new Error(`unhandled validation diagnostic: ${_exhaustive}`);
    }
  }
}

export function formatValidationDiagnosticWarnings(
  diagnostics: readonly ValidationDiagnostic[],
): string[] {
  return diagnostics.map(formatValidationDiagnostic);
}

function formatValidationDiagnosticBlock(
  diagnostic: ValidationDiagnostic,
): string[] {
  const heading = `[${diagnostic.code}] ${diagnostic.subject} (${diagnostic.strictBehavior})`;

  switch (diagnostic.code) {
    case "skill.prompt-size":
      return [heading, ...formatPromptSizeDiagnosticBlock(diagnostic)];
    case "skill.drift-token":
    case "skill.stray-file":
    case "skill.unknown-subdir":
      return [heading, ...formatBasicDiagnosticBlock(diagnostic)];
    default: {
      const _exhaustive: never = diagnostic.code;
      throw new Error(`unhandled validation diagnostic: ${_exhaustive}`);
    }
  }
}

function formatPromptSizeDiagnosticBlock(
  diagnostic: ValidationDiagnostic,
): string[] {
  const metrics = diagnostic.metrics;
  const lines = [`  ${diagnostic.summary}`];

  if (metrics) {
    lines.push(
      `  Estimated tokens: ${formatMetric(metrics.estimatedTokens)}`,
      `  Encoding: ${String(metrics.encoding)}`,
      `  UTF-8 bytes: ${formatMetric(metrics.bytes)}`,
      `  Lines: ${formatMetric(metrics.lines)}`,
      `  Target range: ${formatMetric(metrics.targetTokenMin)}-${formatMetric(
        metrics.targetTokenMax,
      )} tokens`,
      `  Soft limit: ${formatMetric(metrics.softTokenLimit)} tokens or ${formatMetric(
        metrics.softLineLimit,
      )} lines`,
    );
  }

  if (diagnostic.hint) lines.push(`  Hint: ${diagnostic.hint}`);
  return lines;
}

function formatBasicDiagnosticBlock(
  diagnostic: ValidationDiagnostic,
): string[] {
  return [
    `  ${diagnostic.summary}`,
    ...(diagnostic.details ?? []).map((detail) => `  ${detail}`),
    ...(diagnostic.hint ? [`  Hint: ${diagnostic.hint}`] : []),
  ];
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

function formatMetric(value: number | string | undefined): string {
  if (typeof value === "number") return value.toLocaleString("en-US");
  if (typeof value === "string") return value;
  return "unknown";
}

function lowercaseFirst(input: string): string {
  return `${input.charAt(0).toLocaleLowerCase("en-US")}${input.slice(1)}`;
}
