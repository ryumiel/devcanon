import { MODEL_TIER_PLACEHOLDER, type ModelTiers } from "../config/schema.js";

type ModelTierTarget = "claude" | "codex";

export function resolveTierProfile<T extends ModelTierTarget>(
  tier: string,
  target: T,
  tiers: ModelTiers | undefined,
): ModelTiers[string][T] {
  if (!tiers) {
    throw new Error(
      "modelTiers not configured — define modelTiers in agents-manager.config.yaml",
    );
  }

  // Use Object.hasOwn so prototype-chain keys like "__proto__" do not
  // resolve to Object.prototype and silently bypass the unknown-tier guard.
  if (!Object.hasOwn(tiers, tier)) {
    throw new Error(
      `unknown model tier "${tier}" — define it under modelTiers in config`,
    );
  }

  return tiers[tier][target];
}

export function resolveTierModel(
  tier: string,
  target: ModelTierTarget,
  tiers: ModelTiers | undefined,
): string {
  return resolveTierProfile(tier, target, tiers).model;
}

export function extractModelTierKey(value: string | undefined): string | null {
  if (!value) return null;
  return value.match(MODEL_TIER_PLACEHOLDER)?.[1] ?? null;
}
