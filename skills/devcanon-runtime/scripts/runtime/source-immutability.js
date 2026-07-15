import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, open, readFile, readlink, realpath, unlink, } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { requireDirectEphemeralChild } from "./paths.js";
const execFileAsync = promisify(execFile);
const BASELINE_PREFIX = ".devcanon-source-immutability-";
const BASELINE_PATTERN = /^\.ephemeral\/\.devcanon-source-immutability-[0-9a-f]{32}\.json$/u;
const PRIVATE_BASELINE_KIND = "devcanon-source-immutability-private";
const GIT_ENVIRONMENT_OVERRIDES = new Set([
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_COMMON_DIR",
    "GIT_DIR",
    "GIT_INDEX_FILE",
    "GIT_NAMESPACE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_REPLACE_REF_BASE",
    "GIT_WORK_TREE",
]);
const HEX_SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const FILE_KINDS = new Set([
    "regular",
    "symlink",
    "missing",
    "directory",
    "block-device",
    "character-device",
    "fifo",
    "socket",
    "other",
]);
export async function runSourceImmutabilityCommand(args, cwd = process.cwd()) {
    try {
        const parsed = parseArgs(args);
        switch (parsed.operation) {
            case "capture":
                return plainOk(`${await capture(cwd, parsed.handoff)}\n`);
            case "verify":
                await verify(cwd, requiredBaseline(parsed), parsed.handoff);
                return plainOk("unchanged\n");
            case "cleanup":
                await cleanup(cwd, requiredBaseline(parsed), parsed.handoff);
                return plainOk("cleaned\n");
        }
    }
    catch (err) {
        return plainFail(singleLineMessage(err));
    }
}
async function capture(cwd, handoff) {
    const workspace = await requireWorkspace(cwd);
    if (handoff !== undefined) {
        validateDirectChild(handoff, "handoff");
        await requireAbsent(workspace.root, handoff, "handoff");
        await requireIgnored(workspace.root, handoff, "handoff");
        await requireUntracked(workspace.root, handoff, "handoff");
    }
    const baseline = {
        kind: PRIVATE_BASELINE_KIND,
        handoff: handoff ?? null,
        fingerprint: await fingerprint(workspace),
    };
    const payload = `${JSON.stringify(baseline)}\n`;
    for (let attempt = 0; attempt < 32; attempt += 1) {
        const candidate = `.ephemeral/${BASELINE_PREFIX}${randomBytes(16).toString("hex")}.json`;
        if (candidate === handoff)
            continue;
        await requireIgnored(workspace.root, candidate, "retained baseline");
        let created = false;
        try {
            const handle = await open(path.join(workspace.root, candidate), "wx", 0o600);
            created = true;
            try {
                await handle.writeFile(payload, { encoding: "utf8" });
            }
            finally {
                await handle.close();
            }
            return candidate;
        }
        catch (err) {
            if (isNodeError(err, "EEXIST"))
                continue;
            if (created) {
                await unlink(path.join(workspace.root, candidate)).catch(() => undefined);
            }
            throw err;
        }
    }
    throw new Error("could not allocate a collision-safe retained baseline");
}
async function verify(cwd, baselinePath, handoff) {
    const workspace = await requireWorkspace(cwd, {
        requireIgnoredEphemeral: false,
    });
    validateBaselinePath(baselinePath);
    if (handoff !== undefined)
        validateDirectChild(handoff, "handoff");
    requireDistinctLeaves(baselinePath, handoff);
    const baseline = await readBaseline(workspace.root, baselinePath);
    requireSameHandoff(baseline, handoff);
    const current = await fingerprint(workspace);
    if (!fingerprintsEqual(baseline.fingerprint, current)) {
        throw new Error("source changed since the retained baseline was captured");
    }
    await validateFreshHandoff(workspace.root, handoff);
}
async function cleanup(cwd, baselinePath, handoff) {
    const root = await requireCleanupRoot(cwd);
    validateBaselinePath(baselinePath);
    if (handoff !== undefined)
        validateDirectChild(handoff, "handoff");
    requireDistinctLeaves(baselinePath, handoff);
    const baselineLeaf = await cleanupLeaf(root, baselinePath, "baseline");
    const handoffLeaf = handoff === undefined
        ? undefined
        : await cleanupLeaf(root, handoff, "handoff");
    if (baselineLeaf === "regular") {
        const baseline = await readBaseline(root, baselinePath);
        requireSameHandoff(baseline, handoff);
        if (baseline.fingerprint.worktree !== root) {
            throw new Error("retained baseline belongs to a different worktree");
        }
    }
    // All requested leaves and the retained declaration have been validated.
    if (baselineLeaf !== "missing") {
        await unlink(path.join(root, baselinePath));
    }
    if (handoff !== undefined && handoffLeaf !== "missing") {
        await unlink(path.join(root, handoff));
    }
}
async function requireCleanupRoot(inputCwd) {
    const root = await realpath(inputCwd);
    const ephemeralPath = path.join(root, ".ephemeral");
    try {
        const stat = await lstat(ephemeralPath);
        if (stat.isSymbolicLink() || !stat.isDirectory()) {
            throw new Error(".ephemeral must be a real nonsymlinked directory");
        }
        if ((await realpath(ephemeralPath)) !== ephemeralPath) {
            throw new Error(".ephemeral must resolve inside the cleanup root");
        }
    }
    catch (err) {
        if (!isNodeError(err, "ENOENT"))
            throw err;
    }
    return root;
}
function parseArgs(args) {
    const [operation, ...rest] = args;
    if (operation !== "capture" &&
        operation !== "verify" &&
        operation !== "cleanup") {
        throw new Error("usage: source-immutability capture [--handoff <path>] | verify --baseline <path> [--handoff <path>] | cleanup --baseline <path> [--handoff <path>]");
    }
    let baseline;
    let handoff;
    for (let index = 0; index < rest.length; index += 2) {
        const flag = rest[index];
        const value = rest[index + 1];
        if (value === undefined)
            throw new Error(`${flag} requires a value`);
        if (flag === "--baseline") {
            if (baseline !== undefined) {
                throw new Error("--baseline may be supplied only once");
            }
            baseline = value;
        }
        else if (flag === "--handoff") {
            if (handoff !== undefined) {
                throw new Error("--handoff may be supplied only once");
            }
            handoff = value;
        }
        else {
            throw new Error(`unknown source-immutability argument: ${flag}`);
        }
    }
    if (operation === "capture" && baseline !== undefined) {
        throw new Error("capture does not accept --baseline");
    }
    if (operation !== "capture" && baseline === undefined) {
        throw new Error(`${operation} requires --baseline`);
    }
    return { operation, baseline, handoff };
}
function requiredBaseline(parsed) {
    if (parsed.baseline === undefined) {
        throw new Error(`${parsed.operation} requires --baseline`);
    }
    return parsed.baseline;
}
async function requireWorkspace(inputCwd, options = {}) {
    const cwd = await realpath(inputCwd);
    const inside = (await gitText(["rev-parse", "--is-inside-work-tree"], cwd)).trim();
    const bare = (await gitText(["rev-parse", "--is-bare-repository"], cwd)).trim();
    if (inside !== "true" || bare !== "false") {
        throw new Error("source-immutability requires a real Git worktree");
    }
    const topLevel = (await gitText(["rev-parse", "--show-toplevel"], cwd)).trim();
    const root = await realpath(topLevel);
    if (cwd !== root) {
        throw new Error("source-immutability must run from the repository root");
    }
    if (options.requireHead !== false) {
        await gitText(["rev-parse", "--verify", "HEAD^{commit}"], root);
    }
    const gitDirOutput = (await gitText(["rev-parse", "--absolute-git-dir"], root)).trim();
    const gitDir = await realpath(gitDirOutput);
    await requireEphemeralDirectory(root, options.requireIgnoredEphemeral !== false);
    return { root, gitDir };
}
async function requireEphemeralDirectory(root, validateIgnored) {
    const ephemeralPath = path.join(root, ".ephemeral");
    let stat;
    try {
        stat = await lstat(ephemeralPath);
    }
    catch (err) {
        if (isNodeError(err, "ENOENT")) {
            throw new Error(".ephemeral must already exist as an ignored directory");
        }
        throw err;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error(".ephemeral must be a real nonsymlinked directory");
    }
    const physical = await realpath(ephemeralPath);
    if (physical !== path.join(root, ".ephemeral")) {
        throw new Error(".ephemeral must resolve inside the canonical worktree");
    }
    if (validateIgnored) {
        await requireIgnored(root, ".ephemeral/.devcanon-ignore-probe", ".ephemeral");
    }
}
async function fingerprint(workspace) {
    const head = (await gitText(["rev-parse", "--verify", "HEAD^{commit}"], workspace.root)).trim();
    const symbolic = await gitResult(["symbolic-ref", "-q", "HEAD"], workspace.root, [0, 1]);
    const symbolicRef = symbolic.exitCode === 0 ? symbolic.stdout.toString("utf8").trim() : null;
    const [rawIndex, gitStatus, gitInfoExcludeSha256] = await Promise.all([
        completeIndexEntryState(workspace.root),
        gitRaw([
            "--no-optional-locks",
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            "--ignore-submodules=none",
        ], workspace.root),
        fingerprintGitInfoExclude(workspace.root),
    ]);
    const pathSets = await Promise.all([
        gitRaw(["ls-tree", "-r", "--name-only", "-z", "HEAD"], workspace.root),
        gitRaw(["ls-files", "-z"], workspace.root),
        gitRaw(["ls-files", "--others", "--exclude-standard", "-z"], workspace.root),
    ]);
    return {
        worktree: workspace.root,
        gitDir: workspace.gitDir,
        head,
        symbolicRef,
        indexSha256: sha256(rawIndex),
        gitStatusSha256: sha256(gitStatus),
        gitInfoExcludeSha256,
        files: await fingerprintListedPaths(workspace.root, pathSets, true),
    };
}
async function fingerprintListedPaths(root, pathSets, includeNestedGitState) {
    const uniquePaths = new Map();
    for (const output of pathSets) {
        for (const entry of splitNul(output)) {
            const canonicalEntry = canonicalizeGitListedPath(entry);
            uniquePaths.set(canonicalEntry.toString("hex"), canonicalEntry);
        }
    }
    const files = [];
    for (const relativePath of [...uniquePaths.values()].sort(Buffer.compare)) {
        files.push(await fingerprintPath(root, relativePath, includeNestedGitState));
    }
    return files;
}
function canonicalizeGitListedPath(value) {
    if (value.length > 1 && value[value.length - 1] === 0x2f) {
        return value.subarray(0, value.length - 1);
    }
    return value;
}
async function completeIndexEntryState(root) {
    // These stable, NUL-delimited plumbing views jointly cover entry identity,
    // stage, assume-unchanged, skip-worktree, fsmonitor-valid, and intent-to-add
    // state without including mutable index stat-cache fields.
    const views = await Promise.all([
        gitRaw(["ls-files", "--stage", "-z"], root),
        gitRaw(["ls-files", "--cached", "-v", "-z"], root),
        gitRaw(["ls-files", "--cached", "-f", "-z"], root),
        persistentIntentToAddState(root),
    ]);
    const framed = [];
    for (const view of views) {
        const length = Buffer.allocUnsafe(8);
        length.writeBigUInt64BE(BigInt(view.length));
        framed.push(length, view);
    }
    return Buffer.concat(framed);
}
async function persistentIntentToAddState(root) {
    const debug = await gitRaw(["ls-files", "--cached", "--debug", "-z"], root);
    const framed = [];
    let offset = 0;
    while (offset < debug.length) {
        const pathEnd = debug.indexOf(0, offset);
        if (pathEnd === -1) {
            throw new Error("unexpected git ls-files --debug output");
        }
        const relativePath = debug.subarray(offset, pathEnd);
        let metadataEnd = pathEnd + 1;
        for (let line = 0; line < 5; line += 1) {
            metadataEnd = debug.indexOf(0x0a, metadataEnd);
            if (metadataEnd === -1) {
                throw new Error("unexpected git ls-files --debug output");
            }
            metadataEnd += 1;
        }
        const metadata = debug.subarray(pathEnd + 1, metadataEnd).toString("ascii");
        const match = metadata.match(/^ {2}ctime: \d+:\d+\n {2}mtime: \d+:\d+\n {2}dev: \d+\tino: \d+\n {2}uid: \d+\tgid: \d+\n {2}size: \d+\tflags: ([0-9a-f]+)\n$/iu);
        if (match === null) {
            throw new Error("unexpected git ls-files --debug output");
        }
        const pathLength = Buffer.allocUnsafe(8);
        pathLength.writeBigUInt64BE(BigInt(relativePath.length));
        const flags = BigInt(`0x${match[1]}`);
        const intentToAdd = Buffer.from([(flags & 0x20000000n) === 0n ? 0 : 1]);
        framed.push(pathLength, relativePath, intentToAdd);
        offset = metadataEnd;
    }
    return Buffer.concat(framed);
}
async function fingerprintPath(root, relativePath, includeNestedGitState) {
    const absolutePath = Buffer.concat([
        Buffer.from(root),
        Buffer.from(path.sep),
        relativePath,
    ]);
    const encodedPath = relativePath.toString("base64");
    let stat;
    try {
        stat = await lstat(absolutePath);
    }
    catch (err) {
        if (isNodeError(err, "ENOENT")) {
            return {
                path: encodedPath,
                kind: "missing",
                mode: null,
                contentSha256: null,
            };
        }
        throw err;
    }
    const mode = stat.mode & 0o7777;
    if (stat.isFile()) {
        return {
            path: encodedPath,
            kind: "regular",
            mode,
            contentSha256: await sha256File(absolutePath),
        };
    }
    if (stat.isSymbolicLink()) {
        const target = await readlink(absolutePath, { encoding: "buffer" });
        return {
            path: encodedPath,
            kind: "symlink",
            mode,
            contentSha256: sha256(target),
        };
    }
    if (stat.isDirectory()) {
        return {
            path: encodedPath,
            kind: "directory",
            mode,
            contentSha256: includeNestedGitState
                ? await nestedGitStateSha256(absolutePath)
                : null,
        };
    }
    return {
        path: encodedPath,
        kind: fileKind(stat),
        mode,
        contentSha256: null,
    };
}
async function nestedGitStateSha256(absolutePath) {
    const cwd = absolutePath.toString("utf8");
    if (!Buffer.from(cwd).equals(absolutePath))
        return null;
    const topLevelResult = await gitResult(["rev-parse", "--show-toplevel"], cwd, [0, 128]);
    if (topLevelResult.exitCode !== 0)
        return null;
    const [topLevel, physicalCwd] = await Promise.all([
        realpath(topLevelResult.stdout.toString("utf8").trim()),
        realpath(cwd),
    ]);
    if (topLevel !== physicalCwd)
        return null;
    const [headResult, symbolic, rawIndex, gitStatus, gitInfoExcludeSha256] = await Promise.all([
        gitResult(["rev-parse", "--verify", "HEAD^{commit}"], cwd, [0, 128]),
        gitResult(["symbolic-ref", "-q", "HEAD"], cwd, [0, 1]),
        completeIndexEntryState(cwd),
        gitRaw([
            "--no-optional-locks",
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            "--ignore-submodules=none",
        ], cwd),
        fingerprintGitInfoExclude(cwd),
    ]);
    const head = headResult.exitCode === 0
        ? headResult.stdout.toString("utf8").trim()
        : null;
    const pathSets = await Promise.all([
        head === null
            ? Promise.resolve(Buffer.alloc(0))
            : gitRaw(["ls-tree", "-r", "--name-only", "-z", "HEAD"], cwd),
        gitRaw(["ls-files", "-z"], cwd),
        gitRaw(["ls-files", "--others", "--exclude-standard", "-z"], cwd),
    ]);
    return sha256(Buffer.from(JSON.stringify({
        head,
        symbolicRef: symbolic.exitCode === 0
            ? symbolic.stdout.toString("utf8").trim()
            : null,
        indexSha256: sha256(rawIndex),
        gitStatusSha256: sha256(gitStatus),
        gitInfoExcludeSha256,
        files: await fingerprintListedPaths(cwd, pathSets, false),
    })));
}
async function fingerprintGitInfoExclude(root) {
    const gitPath = (await gitText(["rev-parse", "--git-path", "info/exclude"], root)).trim();
    const excludePath = path.resolve(root, gitPath);
    try {
        const contents = await readFile(excludePath);
        return sha256(Buffer.concat([Buffer.from("present\0"), contents]));
    }
    catch (err) {
        if (isNodeError(err, "ENOENT")) {
            return sha256(Buffer.from("missing\0"));
        }
        throw err;
    }
}
function fileKind(stat) {
    if (stat.isDirectory())
        return "directory";
    if (stat.isBlockDevice())
        return "block-device";
    if (stat.isCharacterDevice())
        return "character-device";
    if (stat.isFIFO())
        return "fifo";
    if (stat.isSocket())
        return "socket";
    return "other";
}
async function readBaseline(root, relativePath) {
    const absolutePath = path.join(root, relativePath);
    const stat = await lstat(absolutePath).catch((err) => {
        if (isNodeError(err, "ENOENT")) {
            throw new Error(`retained baseline is missing: ${relativePath}`);
        }
        throw err;
    });
    if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error(`retained baseline must be a nonsymlinked regular file: ${relativePath}`);
    }
    if (stat.size === 0) {
        throw new Error(`retained baseline must be nonempty: ${relativePath}`);
    }
    let parsed;
    try {
        parsed = JSON.parse(await readFile(absolutePath, "utf8"));
    }
    catch {
        throw new Error(`retained baseline is invalid: ${relativePath}`);
    }
    if (!isRetainedBaseline(parsed)) {
        throw new Error(`retained baseline is invalid: ${relativePath}`);
    }
    return parsed;
}
function isRetainedBaseline(value) {
    if (!isRecordWithKeys(value, ["kind", "handoff", "fingerprint"])) {
        return false;
    }
    if (value.kind !== PRIVATE_BASELINE_KIND)
        return false;
    if (value.handoff !== null) {
        if (typeof value.handoff !== "string")
            return false;
        try {
            requireDirectEphemeralChild(value.handoff);
        }
        catch {
            return false;
        }
    }
    return isWorkspaceFingerprint(value.fingerprint);
}
function isWorkspaceFingerprint(value) {
    if (!isRecordWithKeys(value, [
        "worktree",
        "gitDir",
        "head",
        "symbolicRef",
        "indexSha256",
        "gitStatusSha256",
        "gitInfoExcludeSha256",
        "files",
    ])) {
        return false;
    }
    if (!isAbsolutePrivatePath(value.worktree))
        return false;
    if (!isAbsolutePrivatePath(value.gitDir))
        return false;
    if (typeof value.head !== "string" || !GIT_OBJECT_ID.test(value.head)) {
        return false;
    }
    if (value.symbolicRef !== null &&
        (typeof value.symbolicRef !== "string" ||
            !value.symbolicRef.startsWith("refs/") ||
            /[\0\r\n]/u.test(value.symbolicRef))) {
        return false;
    }
    if (typeof value.indexSha256 !== "string" ||
        !HEX_SHA256.test(value.indexSha256)) {
        return false;
    }
    if (typeof value.gitStatusSha256 !== "string" ||
        !HEX_SHA256.test(value.gitStatusSha256)) {
        return false;
    }
    if (typeof value.gitInfoExcludeSha256 !== "string" ||
        !HEX_SHA256.test(value.gitInfoExcludeSha256)) {
        return false;
    }
    if (!Array.isArray(value.files))
        return false;
    let previousPath;
    for (const entry of value.files) {
        if (!isFileFingerprint(entry))
            return false;
        const decodedPath = Buffer.from(entry.path, "base64");
        if (previousPath !== undefined &&
            Buffer.compare(previousPath, decodedPath) >= 0) {
            return false;
        }
        previousPath = decodedPath;
    }
    return true;
}
function isFileFingerprint(value) {
    if (!isRecordWithKeys(value, ["path", "kind", "mode", "contentSha256"])) {
        return false;
    }
    if (typeof value.path !== "string" ||
        !isCanonicalNonemptyBase64(value.path)) {
        return false;
    }
    if (typeof value.kind !== "string" || !FILE_KINDS.has(value.kind)) {
        return false;
    }
    if (value.kind === "missing") {
        return value.mode === null && value.contentSha256 === null;
    }
    if (typeof value.mode !== "number" ||
        !Number.isInteger(value.mode) ||
        value.mode < 0 ||
        value.mode > 0o7777) {
        return false;
    }
    if (value.kind === "regular" ||
        value.kind === "symlink" ||
        (value.kind === "directory" && value.contentSha256 !== null)) {
        return (typeof value.contentSha256 === "string" &&
            HEX_SHA256.test(value.contentSha256));
    }
    return value.contentSha256 === null;
}
function isRecordWithKeys(value, expectedKeys) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const actualKeys = Object.keys(value).sort();
    const sortedExpected = [...expectedKeys].sort();
    return (actualKeys.length === sortedExpected.length &&
        actualKeys.every((key, index) => key === sortedExpected[index]));
}
function isAbsolutePrivatePath(value) {
    return (typeof value === "string" &&
        path.isAbsolute(value) &&
        !/[\0\r\n]/u.test(value));
}
function isCanonicalNonemptyBase64(value) {
    if (value.length === 0 || value.length % 4 !== 0)
        return false;
    const decoded = Buffer.from(value, "base64");
    return (decoded.toString("base64") === value &&
        isCanonicalRepositoryRelativeGitPath(decoded));
}
function isCanonicalRepositoryRelativeGitPath(value) {
    if (value.length === 0 || value.includes(0))
        return false;
    const separators = process.platform === "win32" ? new Set([0x2f, 0x5c]) : new Set([0x2f]);
    if (separators.has(value[0]) || separators.has(value[value.length - 1])) {
        return false;
    }
    if (process.platform === "win32" &&
        value.length >= 2 &&
        ((value[0] >= 0x41 && value[0] <= 0x5a) ||
            (value[0] >= 0x61 && value[0] <= 0x7a)) &&
        value[1] === 0x3a) {
        return false;
    }
    let componentStart = 0;
    for (let index = 0; index <= value.length; index += 1) {
        if (index < value.length && !separators.has(value[index]))
            continue;
        const component = value.subarray(componentStart, index);
        if (component.length === 0 ||
            (component.length === 1 && component[0] === 0x2e) ||
            (component.length === 2 && component[0] === 0x2e && component[1] === 0x2e)) {
            return false;
        }
        componentStart = index + 1;
    }
    return true;
}
function requireSameHandoff(baseline, handoff) {
    if (baseline.handoff !== (handoff ?? null)) {
        throw new Error("handoff declaration does not match the retained baseline");
    }
}
async function validateFreshHandoff(root, handoff) {
    if (handoff === undefined)
        return;
    const absolutePath = path.join(root, handoff);
    let stat;
    try {
        stat = await lstat(absolutePath);
    }
    catch (err) {
        if (isNodeError(err, "ENOENT")) {
            throw new Error(`declared handoff is missing: ${handoff}`);
        }
        throw err;
    }
    if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error(`declared handoff must be a nonsymlinked regular file: ${handoff}`);
    }
    if (stat.size === 0) {
        throw new Error(`declared handoff must be nonempty: ${handoff}`);
    }
    try {
        const handle = await open(absolutePath, "r");
        await handle.close();
    }
    catch {
        throw new Error(`declared handoff must be readable: ${handoff}`);
    }
}
async function cleanupLeaf(root, relativePath, label) {
    try {
        const stat = await lstat(path.join(root, relativePath));
        if (stat.isSymbolicLink())
            return "symlink";
        if (stat.isFile())
            return "regular";
        throw new Error(`${label} cleanup path has a disallowed file kind: ${relativePath}`);
    }
    catch (err) {
        if (isNodeError(err, "ENOENT"))
            return "missing";
        throw err;
    }
}
function validateBaselinePath(value) {
    validateDirectChild(value, "baseline");
    if (!BASELINE_PATTERN.test(value)) {
        throw new Error("baseline path is not a retained source-immutability baseline");
    }
}
function requireDistinctLeaves(baseline, handoff) {
    if (handoff === baseline) {
        throw new Error("baseline and handoff must be distinct leaves");
    }
}
function validateDirectChild(value, label) {
    try {
        requireDirectEphemeralChild(value);
    }
    catch {
        throw new Error(`${label} must be a direct child of .ephemeral`);
    }
}
async function requireAbsent(root, relativePath, label) {
    try {
        await lstat(path.join(root, relativePath));
    }
    catch (err) {
        if (isNodeError(err, "ENOENT"))
            return;
        throw err;
    }
    throw new Error(`${label} must be absent at capture: ${relativePath}`);
}
async function requireIgnored(root, relativePath, label) {
    const result = await gitResult(["check-ignore", "-q", "--", relativePath], root, [0, 1]);
    if (result.exitCode !== 0) {
        throw new Error(`${label} must be ignored by Git: ${relativePath}`);
    }
}
async function requireUntracked(root, relativePath, label) {
    const result = await gitResult(["ls-files", "--error-unmatch", "--", relativePath], root, [0, 1]);
    if (result.exitCode === 0) {
        throw new Error(`${label} must be untracked: ${relativePath}`);
    }
}
function fingerprintsEqual(baseline, current) {
    return JSON.stringify(baseline) === JSON.stringify(current);
}
async function gitText(args, cwd) {
    return (await gitResult(args, cwd)).stdout.toString("utf8");
}
async function gitRaw(args, cwd) {
    return (await gitResult(args, cwd)).stdout;
}
async function gitResult(args, cwd, allowedExitCodes = [0]) {
    try {
        const { stdout, stderr } = await execFileAsync("git", [...args], {
            cwd,
            encoding: "buffer",
            env: canonicalGitEnv(),
            shell: false,
            windowsHide: true,
            maxBuffer: 64 * 1024 * 1024,
        });
        return { exitCode: 0, stdout, stderr };
    }
    catch (err) {
        const failure = err;
        const code = typeof failure.code === "number" ? failure.code : 1;
        const result = {
            exitCode: code,
            stdout: failure.stdout ?? Buffer.alloc(0),
            stderr: failure.stderr ?? Buffer.from(failure.message),
        };
        if (allowedExitCodes.includes(code))
            return result;
        throw new Error(result.stderr.toString("utf8").trim() || failure.message);
    }
}
function canonicalGitEnv() {
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_CONFIG") && !GIT_ENVIRONMENT_OVERRIDES.has(name)));
    env.GIT_NO_REPLACE_OBJECTS = "1";
    return env;
}
function splitNul(value) {
    const result = [];
    let start = 0;
    for (let index = 0; index < value.length; index += 1) {
        if (value[index] === 0) {
            if (index > start)
                result.push(value.subarray(start, index));
            start = index + 1;
        }
    }
    if (start < value.length)
        result.push(value.subarray(start));
    return result;
}
function sha256(value) {
    return createHash("sha256").update(value).digest("hex");
}
async function sha256File(filePath) {
    const hash = createHash("sha256");
    await new Promise((resolve, reject) => {
        const stream = createReadStream(filePath);
        stream.on("data", (chunk) => hash.update(chunk));
        stream.on("error", reject);
        stream.on("end", resolve);
    });
    return hash.digest("hex");
}
function isNodeError(err, code) {
    return (err !== null &&
        typeof err === "object" &&
        "code" in err &&
        err.code === code);
}
function singleLineMessage(err) {
    const message = err instanceof Error ? err.message : String(err);
    return (message.replace(/[\r\n]+/gu, " ").trim() || "source-immutability failed");
}
function plainOk(stdout) {
    return { exitCode: 0, stdout, stderr: "" };
}
function plainFail(message) {
    return { exitCode: 1, stdout: "", stderr: `${message}\n` };
}
