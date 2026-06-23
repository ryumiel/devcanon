import { TextDecoder } from "node:util";
export class GitDiffParserError extends Error {
    constructor(message) {
        super(message);
        this.name = "GitDiffParserError";
    }
}
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
export function parseGitNameStatusZ(buffer) {
    const tokens = decodeNulTerminatedTokens(buffer, "name-status");
    const entries = [];
    for (let index = 0; index < tokens.length;) {
        const rawStatus = tokens[index];
        index += 1;
        if (rawStatus === undefined || rawStatus.length === 0) {
            throwMalformed("name-status");
        }
        const nameStatus = parseNameStatusHeader(rawStatus);
        if (nameStatus === "renamed" || nameStatus === "copied") {
            const previousPath = tokens[index];
            const currentPath = tokens[index + 1];
            if (previousPath === undefined ||
                currentPath === undefined ||
                !isGitPathToken(previousPath) ||
                !isGitPathToken(currentPath)) {
                throwMalformed("name-status");
            }
            index += 2;
            entries.push({
                path: currentPath,
                previousPath,
                status: nameStatus,
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
            status: nameStatus,
        });
    }
    return entries;
}
function parseNameStatusHeader(rawStatus) {
    switch (rawStatus) {
        case "A":
            return "added";
        case "M":
            return "modified";
        case "T":
            return "modified";
        case "D":
            return "removed";
        default:
            break;
    }
    if (isValidNameStatusScore(rawStatus, "R")) {
        return "renamed";
    }
    if (isValidNameStatusScore(rawStatus, "C")) {
        return "copied";
    }
    throwMalformed("name-status");
}
function isValidNameStatusScore(rawStatus, prefix) {
    if (!rawStatus.startsWith(prefix)) {
        return false;
    }
    const scoreText = rawStatus.slice(1);
    if (!/^[0-9]{1,3}$/u.test(scoreText)) {
        return false;
    }
    const score = Number(scoreText);
    return score >= 0 && score <= 100;
}
export function parseGitNumstatZ(buffer) {
    const tokens = decodeNulTerminatedTokens(buffer, "numstat");
    const entries = [];
    const seen = new Set();
    for (let index = 0; index < tokens.length;) {
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
        const entry = simplePath.length === 0
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
export function parseGitChangedFilesZ(buffer) {
    return decodeNulTerminatedTokens(buffer, "changed files");
}
export function isRepoPathIdentity(value) {
    return (typeof value === "string" &&
        value.length > 0 &&
        !value.startsWith("/") &&
        !value.includes("\0") &&
        value
            .split("/")
            .every((part) => part !== "" && part !== "." && part !== ".."));
}
export function gitPathPairKey(entry) {
    if (!isGitPathToken(entry.path) || !isNullableGitPath(entry.previousPath)) {
        throw new GitDiffParserError("path identity contains NUL");
    }
    return [entry.path, entry.previousPath ?? ""].join("\0");
}
function parseRenameNumstatEntry(tokens, index, numeric) {
    const previousPath = tokens[index];
    const filePath = tokens[index + 1];
    if (previousPath === undefined ||
        filePath === undefined ||
        !isGitPathToken(previousPath) ||
        !isGitPathToken(filePath)) {
        throwMalformed("numstat");
    }
    return {
        path: filePath,
        previousPath,
        ...numeric,
    };
}
function parseNumstatCounts(additionsRaw, deletionsRaw) {
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
function decodeNulTerminatedTokens(buffer, recordKind) {
    if (buffer.length === 0) {
        return [];
    }
    if (buffer.at(-1) !== 0) {
        throwMalformed(recordKind);
    }
    const tokens = [];
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
function decodeUtf8(buffer, recordKind) {
    try {
        return UTF8_DECODER.decode(buffer);
    }
    catch {
        throw new GitDiffParserError(`invalid UTF-8 in git ${recordKind} output`);
    }
}
function isGitPathToken(value) {
    return value.length > 0 && !value.includes("\0");
}
function isNullableGitPath(value) {
    return value === null || isGitPathToken(value);
}
function throwMalformed(recordKind) {
    throw new GitDiffParserError(`malformed git ${recordKind} output`);
}
