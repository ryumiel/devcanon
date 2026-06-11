import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
export class RuntimePathError extends Error {
    problem;
    constructor(problem, message) {
        super(message);
        this.problem = problem;
        this.name = "RuntimePathError";
    }
}
export function normalizeRuntimePath(input, platform = process.platform === "win32"
    ? "win32"
    : "posix") {
    if (input.length === 0) {
        throw new RuntimePathError("empty-path", "path must not be empty");
    }
    const pathApi = platform === "win32" ? path.win32 : path.posix;
    const normalized = pathApi.normalize(input);
    const parsed = pathApi.parse(normalized);
    const segments = normalized
        .slice(parsed.root.length)
        .split(/[\\/]+/u)
        .filter(Boolean);
    const comparable = platform === "win32"
        ? normalized.replace(/\\/gu, "/").toLowerCase()
        : normalized;
    return {
        original: input,
        platform,
        normalized,
        root: parsed.root,
        segments,
        isAbsolute: pathApi.isAbsolute(normalized),
        comparable,
    };
}
export function requireAbsoluteRuntimePath(input, platform) {
    const normalized = normalizeRuntimePath(input, platform);
    if (!normalized.isAbsolute) {
        throw new RuntimePathError("relative-path", "path must be absolute");
    }
    return normalized;
}
export function requireDirectEphemeralChild(input) {
    const normalized = input.replace(/\\/gu, "/");
    if (!normalized.startsWith(".ephemeral/")) {
        throw new RuntimePathError("outside-ephemeral", "path must be a direct child under .ephemeral");
    }
    const rest = normalized.slice(".ephemeral/".length);
    if (rest.length === 0 || rest.includes("/")) {
        throw new RuntimePathError("nested-path", "path must be a direct child under .ephemeral");
    }
    if (rest === "." || rest === ".." || rest.includes("..")) {
        throw new RuntimePathError("path-traversal", "path traversal is not allowed");
    }
    return { ok: true, path: `.ephemeral/${rest}`, filename: rest };
}
export async function assertNoSymlinkOrReparsePoint(root, candidate) {
    const lexicalRel = path.relative(root, candidate);
    if (lexicalRel.startsWith("..") || path.isAbsolute(lexicalRel)) {
        throw new RuntimePathError("symlink-or-reparse-point", "path is outside the trusted root");
    }
    let lexicalCursor = root;
    for (const segment of lexicalRel.split(path.sep).filter(Boolean)) {
        lexicalCursor = path.join(lexicalCursor, segment);
        const stat = await lstat(lexicalCursor);
        if (stat.isSymbolicLink()) {
            throw new RuntimePathError("symlink-or-reparse-point", "path contains a symlink or reparse point");
        }
    }
    const rootReal = await realpath(root);
    const candidateReal = await realpath(candidate);
    const rel = path.relative(rootReal, candidateReal);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
        throw new RuntimePathError("symlink-or-reparse-point", "path resolves outside the trusted root");
    }
    let cursor = rootReal;
    for (const segment of rel.split(path.sep).filter(Boolean)) {
        cursor = path.join(cursor, segment);
        const stat = await lstat(cursor);
        if (stat.isSymbolicLink()) {
            throw new RuntimePathError("symlink-or-reparse-point", "path contains a symlink or reparse point");
        }
    }
}
