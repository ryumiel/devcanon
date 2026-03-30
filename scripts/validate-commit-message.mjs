#!/usr/bin/env node

import { readFileSync } from "node:fs";

const allowedTypes = [
  "feat",
  "fix",
  "refactor",
  "perf",
  "style",
  "test",
  "docs",
  "build",
  "ops",
  "chore",
];

const filePath = process.argv[2] === "--" ? process.argv[3] : process.argv[2];

if (!filePath) {
  console.error("Commit message file path is required.");
  process.exit(1);
}

const raw = readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
const lines = raw.split("\n");
const subject = lines[0] ?? "";

if (
  subject.startsWith("Merge ") ||
  subject.startsWith("Revert ") ||
  subject.startsWith("fixup!") ||
  subject.startsWith("squash!")
) {
  process.exit(0);
}

const subjectPattern = new RegExp(
  `^(?:${allowedTypes.join("|")})(?:\\([a-z0-9][a-z0-9-]*\\))?!?: .+$`,
);

if (!subjectPattern.test(subject)) {
  console.error(
    "Invalid commit subject. Use type(scope): subject or type: subject with an allowed Conventional Commit type.",
  );
  process.exit(1);
}

if (subject.length > 80) {
  console.error("Commit subject must be 80 characters or fewer.");
  process.exit(1);
}

if (subject.endsWith(".")) {
  console.error("Commit subject must not end with a period.");
  process.exit(1);
}

const hasBody = lines.slice(1).some((line) => line.trim() !== "");

if (hasBody && lines[1] !== "") {
  console.error("Leave one blank line between the subject and body.");
  process.exit(1);
}

for (const [index, line] of lines.slice(2).entries()) {
  if (line.length > 80) {
    console.error(`Commit body line ${index + 3} exceeds 80 characters.`);
    process.exit(1);
  }
}

process.exit(0);
