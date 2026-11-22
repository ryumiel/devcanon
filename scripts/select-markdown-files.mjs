import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

function getTrackedMarkdownFiles() {
  const output = execFileSync("git", ["ls-files", "--", "*.md"], {
    encoding: "utf8",
  }).trim();

  if (!output) {
    return [];
  }

  return output
    .split("\n")
    .filter(Boolean)
    .filter((file) => existsSync(file));
}

export function getRequestedMarkdownFiles(args) {
  const separatorIndex = args.indexOf("--");
  const explicitFiles =
    separatorIndex >= 0
      ? args.slice(separatorIndex + 1)
      : args.filter((arg) => !arg.startsWith("--"));

  if (explicitFiles.length > 0) {
    return explicitFiles.filter((file) => existsSync(file));
  }

  return getTrackedMarkdownFiles();
}
