import type { ModelTiers } from "../config/schema.js";

const MODEL_TIER_PLACEHOLDER = /^\{\{model:(\w+)\}\}$/;
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

  const entry = tiers[tier];
  if (!entry) {
    throw new Error(
      `unknown model key "${tier}" — define it under modelTiers in config`,
    );
  }

  return entry[target];
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
