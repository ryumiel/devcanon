import { describe, expect, expectTypeOf, it } from "vitest";
import type { CapabilityProfiles } from "../config/schema.js";
import { resolveCapabilityModel } from "./capability-profiles.js";

const PROFILES: CapabilityProfiles = {
  efficient: { claude: "claude-haiku", codex: "gpt-mini" },
  balanced: { claude: "claude-sonnet", codex: "gpt" },
  frontier: { claude: "claude-opus", codex: "gpt-frontier" },
};

describe("resolveCapabilityModel", () => {
  it.each([
    ["claude", "claude-sonnet"],
    ["codex", "gpt"],
  ] as const)("maps capability to the %s model", (target, expected) => {
    expect(
      resolveCapabilityModel(undefined, "balanced", target, PROFILES),
    ).toBe(expected);
  });

  it("prefers a target-local literal model", () => {
    expect(
      resolveCapabilityModel("literal-model", "balanced", "claude", PROFILES),
    ).toBe("literal-model");
  });

  it("returns undefined for ambient model selection", () => {
    expect(
      resolveCapabilityModel(undefined, undefined, "codex", PROFILES),
    ).toBeUndefined();
  });

  it.each(["__proto__", "constructor"])(
    "rejects non-own capability %s",
    (capability) => {
      expect(() =>
        resolveCapabilityModel(
          undefined,
          capability as "balanced",
          "claude",
          PROFILES,
        ),
      ).toThrow(/unknown capability/);
    },
  );

  it("rejects a non-canonical owned custom profile", () => {
    const profiles = {
      ...PROFILES,
      experimental: { claude: "custom-claude", codex: "custom-codex" },
    } as CapabilityProfiles;

    expect(() =>
      resolveCapabilityModel(
        undefined,
        "experimental" as "balanced",
        "claude",
        profiles,
      ),
    ).toThrow(/unknown capability "experimental"/);
  });

  it("preserves literal precedence without validating a bypassed capability", () => {
    const profiles = {
      ...PROFILES,
      experimental: { claude: "custom-claude", codex: "custom-codex" },
    } as CapabilityProfiles;

    expect(
      resolveCapabilityModel(
        "literal-model",
        "experimental" as "balanced",
        "claude",
        profiles,
      ),
    ).toBe("literal-model");
  });

  it.each([
    ["claude", "codex"],
    ["codex", "claude"],
  ] as const)(
    "rejects an inherited %s mapping even when %s is own",
    (target, ownTarget) => {
      const profile = Object.create({
        [target]: "inherited-model",
      }) as CapabilityProfiles["balanced"];
      profile[ownTarget] = "own-model";
      const profiles = { ...PROFILES, balanced: profile };

      expect(() =>
        resolveCapabilityModel(undefined, "balanced", target, profiles),
      ).toThrow(new RegExp(`no own ${target} model mapping`));
    },
  );

  it("returns only a model string or undefined and accepts no effort", () => {
    expectTypeOf(resolveCapabilityModel).parameters.toEqualTypeOf<
      [
        string | undefined,
        "efficient" | "balanced" | "frontier" | undefined,
        "claude" | "codex",
        CapabilityProfiles,
      ]
    >();
    expectTypeOf(resolveCapabilityModel).returns.toEqualTypeOf<
      string | undefined
    >();
  });
});
