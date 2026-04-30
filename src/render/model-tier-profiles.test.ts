import { describe, expect, it } from "vitest";
import type { ModelTiers } from "../config/schema.js";
import { resolveTierModel, resolveTierProfile } from "./model-tier-profiles.js";

const TIERS: ModelTiers = {
  standard: {
    claude: { model: "claude-sonnet-4-7", effort: "medium" },
    codex: { model: "gpt-5.4", reasoning_effort: "medium" },
  },
  deep: {
    claude: { model: "claude-opus-4-7", effort: "high" },
    codex: { model: "gpt-5.4", reasoning_effort: "high" },
  },
};

describe("model tier profiles", () => {
  it("resolves the concrete model string for a target", () => {
    expect(resolveTierModel("standard", "claude", TIERS)).toBe(
      "claude-sonnet-4-7",
    );
    expect(resolveTierModel("deep", "codex", TIERS)).toBe("gpt-5.4");
  });

  it("returns the full target profile for agent rendering", () => {
    expect(resolveTierProfile("standard", "codex", TIERS)).toEqual({
      model: "gpt-5.4",
      reasoning_effort: "medium",
    });
  });

  it("throws when model tiers are missing", () => {
    expect(() => resolveTierModel("standard", "claude", undefined)).toThrow(
      /modelTiers not configured/i,
    );
  });

  it("throws on an unknown tier", () => {
    expect(() => resolveTierProfile("fast", "claude", TIERS)).toThrow(
      /unknown model key "fast"/i,
    );
  });
});
