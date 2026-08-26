import { describe, expect, it } from "vitest";
import { parseRuntimeConfigCatalog } from "./runtime-config.js";

describe("passive runtime configuration catalog", () => {
  it("rejects an extra catalog envelope field", async () => {
    expect(() =>
      parseRuntimeConfigCatalog({
        schema: "devcanon/runtime-config/v1",
        capabilityProfiles: {
          efficient: { claude: "a", codex: "b" },
          balanced: { claude: "c", codex: "d" },
          frontier: { claude: "e", codex: "f" },
        },
        extra: true,
      }),
    ).toThrow(/catalog envelope/i);
  });
});
