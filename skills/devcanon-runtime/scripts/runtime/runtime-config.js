import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
export const RUNTIME_CONFIG_SCHEMA = "devcanon/runtime-config/v1";
const PROFILE_NAMES = ["efficient", "balanced", "frontier"];
const TARGET_NAMES = ["claude", "codex"];
export function runtimeConfigPath() {
    return fileURLToPath(new URL("../../config/runtime-config.json", import.meta.url));
}
export async function loadRuntimeConfigCatalog() {
    const catalogPath = runtimeConfigPath();
    try {
        const bundleRoot = fileURLToPath(new URL("../..", import.meta.url));
        const configDirectory = path.dirname(catalogPath);
        const configStat = await lstat(configDirectory);
        if (!configStat.isDirectory() || configStat.isSymbolicLink()) {
            throw new Error("config directory is not a real directory");
        }
        if (!(await lstat(catalogPath)).isFile()) {
            throw new Error("not a regular file");
        }
        const physicalBundleRoot = await realpath(bundleRoot);
        const physicalConfigDirectory = await realpath(configDirectory);
        const physicalCatalogPath = await realpath(catalogPath);
        if (!isPathInside(physicalBundleRoot, physicalConfigDirectory) ||
            !isPathInside(physicalConfigDirectory, physicalCatalogPath)) {
            throw new Error("catalog path escapes the runtime bundle");
        }
        const raw = await readFile(catalogPath, "utf-8");
        const parsed = JSON.parse(raw);
        assertNoDuplicateJsonObjectKeys(raw);
        return parseRuntimeConfigCatalog(parsed);
    }
    catch (error) {
        throw new Error(`invalid runtime configuration catalog: ${error.message}`);
    }
}
function isPathInside(parent, candidate) {
    const relative = path.relative(parent, candidate);
    return (relative === "" ||
        (!relative.startsWith(`..${path.sep}`) &&
            relative !== ".." &&
            !path.isAbsolute(relative)));
}
export function getRuntimeConfigValue(catalog, key) {
    if (!isSafeKey(key))
        throw new Error(`invalid configuration key: ${key}`);
    let value = catalog;
    for (const segment of key.split(".")) {
        if (value === null ||
            typeof value !== "object" ||
            Array.isArray(value) ||
            !Object.hasOwn(value, segment)) {
            throw new Error(`configuration key not found: ${key}`);
        }
        value = value[segment];
    }
    if (typeof value !== "string") {
        throw new Error(`configuration key is not a scalar value: ${key}`);
    }
    return value;
}
export function parseRuntimeConfigCatalog(value) {
    if (!isExactObject(value, ["schema", "capabilityProfiles"])) {
        throw new Error("catalog envelope must contain only schema and capabilityProfiles");
    }
    if (value.schema !== RUNTIME_CONFIG_SCHEMA) {
        throw new Error(`unsupported runtime configuration schema: ${String(value.schema)}`);
    }
    if (!isExactObject(value.capabilityProfiles, PROFILE_NAMES)) {
        throw new Error("capabilityProfiles must contain efficient, balanced, and frontier");
    }
    for (const profileName of PROFILE_NAMES) {
        const profile = value.capabilityProfiles[profileName];
        if (!isExactObject(profile, TARGET_NAMES)) {
            throw new Error(`${profileName} must contain claude and codex`);
        }
        for (const targetName of TARGET_NAMES) {
            if (!isRuntimeModel(profile[targetName])) {
                throw new Error(`${profileName}.${targetName} must be a nonblank render-safe model identifier`);
            }
        }
    }
    return value;
}
function isExactObject(value, expectedKeys) {
    return (value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.keys(value).length === expectedKeys.length &&
        expectedKeys.every((key) => Object.hasOwn(value, key)));
}
function isRuntimeModel(value) {
    if (typeof value !== "string" || value.length === 0 || value.length > 256) {
        return false;
    }
    if (value.trim().length === 0)
        return false;
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code <= 0x1f ||
            code === 0x7f ||
            code === 0x85 ||
            code === 0x2028 ||
            code === 0x2029) {
            return false;
        }
    }
    return true;
}
function isSafeKey(key) {
    const segments = key.split(".");
    return (key.length > 0 &&
        segments.every((segment) => /^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(segment) &&
            !["__proto__", "constructor", "prototype"].includes(segment)));
}
function assertNoDuplicateJsonObjectKeys(raw) {
    let offset = 0;
    const skipWhitespace = () => {
        while (/\s/u.test(raw[offset] ?? ""))
            offset += 1;
    };
    const parseString = () => {
        const start = offset;
        offset += 1;
        while (offset < raw.length) {
            if (raw[offset] === "\\")
                offset += 2;
            else if (raw[offset] === '"') {
                offset += 1;
                return JSON.parse(raw.slice(start, offset));
            }
            else
                offset += 1;
        }
        throw new Error("unterminated JSON string");
    };
    const parseValue = () => {
        skipWhitespace();
        if (raw[offset] === "{") {
            parseObject();
            return;
        }
        if (raw[offset] === "[") {
            parseArray();
            return;
        }
        if (raw[offset] === '"') {
            parseString();
            return;
        }
        while (offset < raw.length && !/[\s,\]}]/u.test(raw[offset] ?? ""))
            offset += 1;
    };
    const parseObject = () => {
        const keys = new Set();
        offset += 1;
        skipWhitespace();
        if (raw[offset] === "}") {
            offset += 1;
            return;
        }
        while (true) {
            skipWhitespace();
            const key = parseString();
            if (keys.has(key))
                throw new Error(`duplicate JSON key "${key}"`);
            keys.add(key);
            skipWhitespace();
            offset += 1;
            parseValue();
            skipWhitespace();
            if (raw[offset] === "}") {
                offset += 1;
                return;
            }
            offset += 1;
        }
    };
    const parseArray = () => {
        offset += 1;
        skipWhitespace();
        if (raw[offset] === "]") {
            offset += 1;
            return;
        }
        while (true) {
            parseValue();
            skipWhitespace();
            if (raw[offset] === "]") {
                offset += 1;
                return;
            }
            offset += 1;
        }
    };
    parseValue();
}
