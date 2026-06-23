import { TextDecoder } from "node:util";

export class GitDiffParserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitDiffParserError";
  }
}

export type GitNameStatusEntry = {
  path: string;
  previousPath: string | null;
  status: "added" | "modified" | "removed" | "renamed" | "copied";
};

export type GitNumstatEntry = {
  path: string;
  previousPath: string | null;
  additions: number;
  deletions: number;
  patchAvailable: boolean;
};

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

export function parseGitNameStatusZ(buffer: Buffer): GitNameStatusEntry[] {
  const tokens = decodeNulTerminatedTokens(buffer, "name-status");
  const entries: GitNameStatusEntry[] = [];
  for (let index = 0; index < tokens.length; ) {
    const rawStatus = tokens[index];
    index += 1;
    if (rawStatus === undefined || rawStatus.length === 0) {
      throwMalformed("name-status");
    }
    const statusCode = rawStatus[0] ?? "";
    if (statusCode === "R" || statusCode === "C") {
      const previousPath = tokens[index];
      const currentPath = tokens[index + 1];
      if (
        previousPath === undefined ||
        currentPath === undefined ||
        !isGitPathToken(previousPath) ||
        !isGitPathToken(currentPath)
      ) {
        throwMalformed("name-status");
      }
      index += 2;
      entries.push({
        path: currentPath,
        previousPath,
        status: statusCode === "R" ? "renamed" : "copied",
      });
      continue;
    }
    const currentPath = tokens[index];
    if (currentPath === undefined || !isGitPathToken(currentPath)) {
      throwMalformed("name-status");
    }
    index += 1;
    entries.push({
      path: currentPath,
      previousPath: null,
      status:
        statusCode === "A"
          ? "added"
          : statusCode === "D"
            ? "removed"
            : "modified",
    });
  }
  return entries;
}

export function parseGitNumstatZ(buffer: Buffer): GitNumstatEntry[] {
  const tokens = decodeNulTerminatedTokens(buffer, "numstat");
  const entries: GitNumstatEntry[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < tokens.length; ) {
    const header = tokens[index];
    index += 1;
    if (header === undefined) {
      throwMalformed("numstat");
    }
    const firstTab = header.indexOf("\t");
    const secondTab = firstTab < 0 ? -1 : header.indexOf("\t", firstTab + 1);
    if (firstTab < 0 || secondTab < 0) {
      throwMalformed("numstat");
    }
    const additionsRaw = header.slice(0, firstTab);
    const deletionsRaw = header.slice(firstTab + 1, secondTab);
    const simplePath = header.slice(secondTab + 1);
    const numeric = parseNumstatCounts(additionsRaw, deletionsRaw);
    const entry =
      simplePath.length === 0
        ? parseRenameNumstatEntry(tokens, index, numeric)
        : {
            path: simplePath,
            previousPath: null,
            ...numeric,
          };
    index += simplePath.length === 0 ? 2 : 0;
    if (!isGitPathToken(entry.path) || !isNullableGitPath(entry.previousPath)) {
      throwMalformed("numstat");
    }
    const key = gitPathPairKey(entry);
    if (seen.has(key)) {
      throw new GitDiffParserError("duplicate git numstat metadata key");
    }
    seen.add(key);
    entries.push(entry);
  }
  return entries;
}

export function parseGitChangedFilesZ(buffer: Buffer): string[] {
  return decodeNulTerminatedTokens(buffer, "changed files");
}

export function isRepoPathIdentity(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.includes("\0") &&
    value
      .split("/")
      .every((part) => part !== "" && part !== "." && part !== "..")
  );
}

export function gitPathPairKey(entry: {
  path: string;
  previousPath: string | null;
}): string {
  if (!isGitPathToken(entry.path) || !isNullableGitPath(entry.previousPath)) {
    throw new GitDiffParserError("path identity contains NUL");
  }
  return [entry.path, entry.previousPath ?? ""].join("\0");
}

function parseRenameNumstatEntry(
  tokens: readonly string[],
  index: number,
  numeric: Pick<GitNumstatEntry, "additions" | "deletions" | "patchAvailable">,
): GitNumstatEntry {
  const previousPath = tokens[index];
  const filePath = tokens[index + 1];
  if (
    previousPath === undefined ||
    filePath === undefined ||
    !isGitPathToken(previousPath) ||
    !isGitPathToken(filePath)
  ) {
    throwMalformed("numstat");
  }
  return {
    path: filePath,
    previousPath,
    ...numeric,
  };
}

function parseNumstatCounts(
  additionsRaw: string,
  deletionsRaw: string,
): Pick<GitNumstatEntry, "additions" | "deletions" | "patchAvailable"> {
  if (additionsRaw === "-" && deletionsRaw === "-") {
    return { additions: 0, deletions: 0, patchAvailable: false };
  }
  if (!/^(0|[1-9][0-9]*)$/u.test(additionsRaw)) {
    throwMalformed("numstat");
  }
  if (!/^(0|[1-9][0-9]*)$/u.test(deletionsRaw)) {
    throwMalformed("numstat");
  }
  return {
    additions: Number(additionsRaw),
    deletions: Number(deletionsRaw),
    patchAvailable: true,
  };
}

function decodeNulTerminatedTokens(
  buffer: Buffer,
  recordKind: string,
): string[] {
  if (buffer.length === 0) {
    return [];
  }
  if (buffer.at(-1) !== 0) {
    throwMalformed(recordKind);
  }
  const tokens: string[] = [];
  let start = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] !== 0) {
      continue;
    }
    if (index === start) {
      throwMalformed(recordKind);
    }
    tokens.push(decodeUtf8(buffer.subarray(start, index), recordKind));
    start = index + 1;
  }
  return tokens;
}

function decodeUtf8(buffer: Buffer, recordKind: string): string {
  try {
    return UTF8_DECODER.decode(buffer);
  } catch {
    throw new GitDiffParserError(`invalid UTF-8 in git ${recordKind} output`);
  }
}

function isGitPathToken(value: string): boolean {
  return value.length > 0 && !value.includes("\0");
}

function isNullableGitPath(value: string | null): boolean {
  return value === null || isGitPathToken(value);
}

function throwMalformed(recordKind: string): never {
  throw new GitDiffParserError(`malformed git ${recordKind} output`);
}
