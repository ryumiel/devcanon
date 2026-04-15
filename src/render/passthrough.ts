import { getLogger } from "../utils/output.js";

/**
 * Renderer-side passthrough helpers for unknown target-specific fields.
 * Keeps shape classification and warning emission in one place; each target
 * renderer owns the actual serialization (YAML frontmatter vs TOML), which
 * differ enough that sharing a single emit function would leak either
 * format's quirks into the other.
 */

export const SAFE_PASSTHROUGH_KEY = /^[A-Za-z0-9_-]+$/;

export type PassthroughPrimitive = string | number | boolean | null;

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function isPassthroughPrimitive(v: unknown): v is PassthroughPrimitive {
  return (
    v === null ||
    typeof v === "string" ||
    typeof v === "boolean" ||
    isFiniteNumber(v)
  );
}

export function isHomogeneousScalarArray(
  v: unknown,
): v is ReadonlyArray<string> | ReadonlyArray<number> | ReadonlyArray<boolean> {
  if (!Array.isArray(v) || v.length === 0) return false;
  const first = v[0];
  if (typeof first === "string")
    return v.every((item) => typeof item === "string");
  if (typeof first === "boolean")
    return v.every((item) => typeof item === "boolean");
  if (typeof first === "number" && Number.isFinite(first)) {
    return v.every((item) => typeof item === "number" && Number.isFinite(item));
  }
  return false;
}

export function describeValueShape(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "object") return "object";
  if (typeof v === "number" && !Number.isFinite(v)) return "non-finite number";
  if (typeof v === "undefined") return "undefined";
  return typeof v;
}

export function sortedUnknownEntries(
  target: Record<string, unknown> | null | undefined,
  knownKeys: readonly string[],
): Array<[string, unknown]> {
  if (!target) return [];
  const known = new Set<string>(knownKeys);
  return Object.entries(target)
    .filter(([k]) => !known.has(k))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

export function warnPassthroughSkip(
  target: "claude" | "codex",
  agentName: string,
  key: string,
  reason: string,
): void {
  getLogger().warn(
    `Warning: skipping unrenderable ${target} field "${key}" in agent "${agentName}" (${reason}).`,
  );
}
