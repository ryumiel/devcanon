import { describe, expect, it } from "vitest";
import {
  GPT_TOKEN_ESTIMATE_ENCODING,
  measureSkillPrompt,
} from "./token-count.js";

describe("measureSkillPrompt", () => {
  it("reports conventional line counts for trailing-newline text", async () => {
    const metrics = await measureSkillPrompt("first\nsecond\n");

    expect(metrics.lines).toBe(2);
  });

  it("reports one line for non-empty text without a newline", async () => {
    const metrics = await measureSkillPrompt("first");

    expect(metrics.lines).toBe(1);
  });

  it("keeps the fixed GPT token estimate encoding", async () => {
    const metrics = await measureSkillPrompt("hello world");

    expect(metrics.encoding).toBe(GPT_TOKEN_ESTIMATE_ENCODING);
    expect(metrics.estimatedTokens).toBe(2);
  });
});
