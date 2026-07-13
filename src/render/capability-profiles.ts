import type { Capability, CapabilityProfiles } from "../config/schema.js";

type CapabilityTarget = "claude" | "codex";

/** Resolve only a target model. Effort remains an explicit target-native field. */
export function resolveCapabilityModel(
  literalModel: string | undefined,
  capability: Capability | undefined,
  target: CapabilityTarget,
  profiles: CapabilityProfiles,
): string | undefined {
  if (literalModel !== undefined) return literalModel;
  if (capability === undefined) return undefined;

  // Keep defense in depth for programmatic callers that bypass the schema.
  if (!Object.hasOwn(profiles, capability)) {
    throw new Error(`unknown capability "${capability}"`);
  }

  const profile = profiles[capability];
  if (!Object.hasOwn(profile, target)) {
    throw new Error(
      `capability "${capability}" has no own ${target} model mapping`,
    );
  }

  return profile[target];
}
