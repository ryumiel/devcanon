import { describe, expect, it } from "vitest";
import {
  GPT_TOKEN_ESTIMATE_ENCODING,
  SKILL_PROMPT_LINE_WARNING_THRESHOLD,
  SKILL_PROMPT_TARGET_TOKEN_RANGE,
  SKILL_PROMPT_TOKEN_WARNING_THRESHOLD,
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

  it("exports the skill prompt size guideline constants", () => {
    expect(SKILL_PROMPT_TARGET_TOKEN_RANGE).toEqual({
      min: 1500,
      max: 3500,
    });
    expect(SKILL_PROMPT_TOKEN_WARNING_THRESHOLD).toBe(5000);
    expect(SKILL_PROMPT_LINE_WARNING_THRESHOLD).toBe(500);
  });
});
