import {
  type ModelProfile,
  ModelProfileSchema,
  type ModelProfiles,
} from "../config/schema.js";

type ModelTarget = "claude" | "codex";

/** Resolve the model for a profile and target. Effort is configured separately. */
export function resolveProfileModel(
  profile: ModelProfile,
  target: ModelTarget,
  profiles: ModelProfiles,
): string {
  const name = ModelProfileSchema.parse(profile);
  const entry = profiles[name];
  if (!Object.hasOwn(profiles, name) || !entry || !(target in entry)) {
    throw new Error(`Model profile "${name}" has no ${target} model`);
  }

  return target === "claude" && "claude" in entry ? entry.claude : entry.codex;
}
