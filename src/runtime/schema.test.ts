import { describe, expect, it } from "vitest";
import { z } from "zod";
import { validateRuntimeSchema } from "./schema.js";

describe("runtime schema utilities", () => {
  it("returns typed values for valid payloads", () => {
    const result = validateRuntimeSchema(
      z.object({ command: z.string(), count: z.number() }),
      { command: "write", count: 1 },
    );
    expect(result).toEqual({
      ok: true,
      value: { command: "write", count: 1 },
    });
  });

  it("returns stable issue fragments for invalid payloads", () => {
    const result = validateRuntimeSchema(
      z.object({ command: z.string(), count: z.number() }),
      { command: 1 },
    );
    expect(result).toEqual({
      ok: false,
      issues: [
        { path: "command", message: "Expected string, received number" },
        { path: "count", message: "Required" },
      ],
    });
  });
});
