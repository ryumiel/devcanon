const MANAGED_MARKER = "Managed by agents-manager";

export function makeMdHeader(sourcePath: string): string {
  return [
    `<!-- ${MANAGED_MARKER}. Do not edit directly. -->`,
    `<!-- Source: ${sourcePath} -->`,
  ].join("\n");
}

export function makeTomlHeader(sourcePath: string): string {
  return [
    `# ${MANAGED_MARKER}. Do not edit directly.`,
    `# Source: ${sourcePath}`,
  ].join("\n");
}

export function hasManagedHeader(
  content: string,
  format: "md" | "toml",
): boolean {
  if (format === "md") {
    return content.startsWith(`<!-- ${MANAGED_MARKER}`);
  }
  return content.startsWith(`# ${MANAGED_MARKER}`);
}

export function extractSourceFromHeader(
  content: string,
  format: "md" | "toml",
): string | null {
  const pattern = format === "md" ? /<!-- Source: (.+?) -->/ : /# Source: (.+)/;
  const match = content.match(pattern);
  return match?.[1] ?? null;
}
