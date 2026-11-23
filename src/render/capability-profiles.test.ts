import { describe, expect, it } from "vitest";
import { CANONICAL_CAPABILITY_PROFILES } from "../__test-helpers__/fixtures.js";
import { resolveProfileModel } from "./capability-profiles.js";

describe("resolveProfileModel", () => {
  it("resolves each profile to its target model", () => {
    for (const [profile, model] of Object.entries(
      CANONICAL_CAPABILITY_PROFILES,
    )) {
      expect(
        resolveProfileModel(
          profile as keyof typeof CANONICAL_CAPABILITY_PROFILES,
          "codex",
          CANONICAL_CAPABILITY_PROFILES,
        ),
      ).toBe(model.codex);
      if ("claude" in model) {
        expect(
          resolveProfileModel(
            profile as keyof typeof CANONICAL_CAPABILITY_PROFILES,
            "claude",
            CANONICAL_CAPABILITY_PROFILES,
          ),
        ).toBe(model.claude);
      }
    }
  });

  it("rejects a missing target mapping", () => {
    expect(() =>
      resolveProfileModel(
        "implementation",
        "claude",
        CANONICAL_CAPABILITY_PROFILES,
      ),
    ).toThrow(/no claude model/);
  });
});
