import { describe, expect, it } from "vitest";
import type { ModelTiers } from "../config/schema.js";
import {
  extractModelTierKey,
  resolveTierModel,
  resolveTierProfile,
} from "./model-tier-profiles.js";

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
      /unknown model tier "fast"/i,
    );
  });

  it("rejects prototype-chain keys like __proto__", () => {
    expect(() => resolveTierProfile("__proto__", "claude", TIERS)).toThrow(
      /unknown model tier "__proto__"/i,
    );
  });

  it("rejects prototype-chain keys like constructor", () => {
    expect(() => resolveTierProfile("constructor", "claude", TIERS)).toThrow(
      /unknown model tier "constructor"/i,
    );
  });
});

describe("extractModelTierKey", () => {
  it("returns the captured tier key for a well-formed placeholder", () => {
    expect(extractModelTierKey("{{model:standard}}")).toBe("standard");
    expect(extractModelTierKey("{{model:deep_v2}}")).toBe("deep_v2");
  });

  it("returns null for undefined input", () => {
    expect(extractModelTierKey(undefined)).toBeNull();
  });

  it("returns null for literal model strings", () => {
    expect(extractModelTierKey("claude-sonnet-4-7")).toBeNull();
  });

  it("returns null for malformed placeholders", () => {
    expect(extractModelTierKey("{{model:foo-bar}}")).toBeNull();
    expect(extractModelTierKey("prefix {{model:standard}}")).toBeNull();
    expect(extractModelTierKey("{{model:}}")).toBeNull();
  });
});
