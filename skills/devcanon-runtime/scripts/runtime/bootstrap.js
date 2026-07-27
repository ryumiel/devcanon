import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { RuntimePathError, parseRuntimeDirectoryPath, } from "./paths.js";
const runtimeEntrypointRelativePath = ["scripts", "devcanon-runtime.sh"];
const typedEntrypointRelativePath = ["scripts", "runtime", "cli.js"];
const forwardedSignals = [
    "SIGINT",
    "SIGTERM",
    "SIGHUP",
];
export class RuntimeBootstrapError extends Error {
    constructor(message) {
        super(message);
        this.name = "RuntimeBootstrapError";
    }
}
/**
 * Validates an override without executing or importing anything it owns.
 * Lexical input validation happens before filesystem normalization; physical
 * containment uses real paths and path.relative rather than text prefixes.
 */
export async function validateRuntimeOverride(rawPath) {
    let parsed;
    try {
        parsed = parseRuntimeDirectoryPath(rawPath);
    }
    catch (error) {
        if (error instanceof RuntimePathError &&
            error.problem === "path-traversal") {
            throw new RuntimeBootstrapError("DEVCANON_RUNTIME_DIR must not contain a parent-directory component");
        }
        throw error;
    }
    let directoryStat;
    try {
        directoryStat = await lstat(parsed.inspectionPath);
    }
    catch {
        throw new RuntimeBootstrapError("DEVCANON_RUNTIME_DIR must name a non-symlink packaged runtime directory");
    }
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
        throw new RuntimeBootstrapError("DEVCANON_RUNTIME_DIR must name a non-symlink packaged runtime directory");
    }
    const lexicalEntrypoint = path.join(parsed.inspectionPath, ...runtimeEntrypointRelativePath);
    await assertNoSymlinkedEntrypointComponent(parsed.inspectionPath, runtimeEntrypointRelativePath, "devcanon-runtime entrypoint");
    let entrypointStat;
    try {
        entrypointStat = await lstat(lexicalEntrypoint);
        await access(lexicalEntrypoint, constants.X_OK);
    }
    catch {
        throw new RuntimeBootstrapError("devcanon-runtime entrypoint must be an executable non-symlink file");
    }
    if (!entrypointStat.isFile() || entrypointStat.isSymbolicLink()) {
        throw new RuntimeBootstrapError("devcanon-runtime entrypoint must be an executable non-symlink file");
    }
    const runtimeDirectory = await realpath(parsed.inspectionPath);
    const entrypoint = await realpath(lexicalEntrypoint);
    if (isOutsideDirectory(runtimeDirectory, entrypoint)) {
        throw new RuntimeBootstrapError("devcanon-runtime entrypoint resolves outside DEVCANON_RUNTIME_DIR");
    }
    const typedEntrypoint = await validateTypedEntrypoint(parsed.inspectionPath, runtimeDirectory);
    return {
        rawPath,
        inspectionPath: parsed.inspectionPath,
        runtimeDirectory,
        entrypoint,
        typedEntrypoint,
    };
}
export async function dispatchRuntimeOverride(rawPath, childArguments) {
    const runtime = await validateRuntimeOverride(rawPath);
    return new Promise((resolve, reject) => {
        const command = process.platform === "win32" ? process.execPath : runtime.entrypoint;
        const args = process.platform === "win32"
            ? [runtime.typedEntrypoint, ...childArguments]
            : ["runtime", ...childArguments];
        const child = spawn(command, args, {
            detached: process.platform !== "win32",
            env: process.env,
            stdio: "inherit",
        });
        const signalHandlers = new Map();
        for (const signal of forwardedSignals) {
            const handler = () => {
                child.kill(signal);
            };
            signalHandlers.set(signal, handler);
            process.on(signal, handler);
        }
        const cleanupSignalHandlers = () => {
            for (const [signal, handler] of signalHandlers) {
                process.removeListener(signal, handler);
            }
        };
        child.once("error", (error) => {
            cleanupSignalHandlers();
            reject(error);
        });
        child.once("close", (exitCode, signal) => {
            cleanupSignalHandlers();
            resolve({ exitCode, signal });
        });
    });
}
async function validateTypedEntrypoint(runtimeDirectory, physicalRuntimeDirectory) {
    const lexicalEntrypoint = path.join(runtimeDirectory, ...typedEntrypointRelativePath);
    await assertNoSymlinkedEntrypointComponent(runtimeDirectory, typedEntrypointRelativePath, "devcanon-runtime typed entrypoint");
    let stat;
    try {
        stat = await lstat(lexicalEntrypoint);
    }
    catch {
        throw new RuntimeBootstrapError("devcanon-runtime typed entrypoint must be a non-symlink file");
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new RuntimeBootstrapError("devcanon-runtime typed entrypoint must be a non-symlink file");
    }
    const typedEntrypoint = await realpath(lexicalEntrypoint);
    if (isOutsideDirectory(physicalRuntimeDirectory, typedEntrypoint)) {
        throw new RuntimeBootstrapError("devcanon-runtime typed entrypoint resolves outside DEVCANON_RUNTIME_DIR");
    }
    return typedEntrypoint;
}
async function assertNoSymlinkedEntrypointComponent(runtimeDirectory, components, entrypointName) {
    let cursor = runtimeDirectory;
    for (const component of components) {
        cursor = path.join(cursor, component);
        let stat;
        try {
            stat = await lstat(cursor);
        }
        catch {
            throw new RuntimeBootstrapError(`${entrypointName} must be a non-symlink file`);
        }
        if (stat.isSymbolicLink()) {
            throw new RuntimeBootstrapError(`${entrypointName} must not contain a symlink or reparse-point component`);
        }
    }
}
function isOutsideDirectory(root, candidate) {
    const relative = path.relative(root, candidate);
    return (relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative));
}
export function formatBootstrapError(error) {
    if (error instanceof RuntimePathError ||
        error instanceof RuntimeBootstrapError) {
        return error.message;
    }
    return error.message;
}
