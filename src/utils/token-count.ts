import { Buffer } from "node:buffer";

export const GPT_TOKEN_ESTIMATE_ENCODING = "o200k_base";
export const SKILL_PROMPT_TARGET_TOKEN_RANGE = {
  min: 1500,
  max: 3500,
} as const;
export const SKILL_PROMPT_TOKEN_WARNING_THRESHOLD = 5000;
export const SKILL_PROMPT_LINE_WARNING_THRESHOLD = 500;
const LONG_UNBROKEN_TEXT_CHUNK_SIZE = 128;

interface TokenMetrics {
  estimatedTokens: number;
  encoding: typeof GPT_TOKEN_ESTIMATE_ENCODING;
  bytes: number;
  lines: number;
}

interface TokenEncoding {
  encode(
    text: string,
    allowedSpecial?: string[] | "all",
    disallowedSpecial?: string[] | "all",
  ): number[];
}

let encodingPromise: Promise<TokenEncoding> | undefined;

export async function measureSkillPrompt(text: string): Promise<TokenMetrics> {
  const encoding = await getTokenEncoding();
  return {
    estimatedTokens: countSkillProseTokens(encoding, text),
    encoding: GPT_TOKEN_ESTIMATE_ENCODING,
    bytes: Buffer.byteLength(text, "utf-8"),
    lines: countLines(text),
  };
}

async function getTokenEncoding(): Promise<TokenEncoding> {
  encodingPromise ??= Promise.all([
    import("js-tiktoken/lite"),
    import("js-tiktoken/ranks/o200k_base"),
  ]).then(([{ Tiktoken }, { default: o200kBase }]) => new Tiktoken(o200kBase));
  return encodingPromise;
}

function countSkillProseTokens(encoding: TokenEncoding, text: string): number {
  let tokenCount = 0;
  let cursor = 0;
  const longRunPattern = new RegExp(
    `\\s{${LONG_UNBROKEN_TEXT_CHUNK_SIZE + 1},}|\\S{${LONG_UNBROKEN_TEXT_CHUNK_SIZE + 1},}`,
    "g",
  );

  for (const match of text.matchAll(longRunPattern)) {
    const matchIndex = match.index;
    if (matchIndex > cursor) {
      tokenCount += encodeSkillProse(
        encoding,
        text.slice(cursor, matchIndex),
      ).length;
    }

    const run = match[0];
    for (
      let index = 0;
      index < run.length;
      index += LONG_UNBROKEN_TEXT_CHUNK_SIZE
    ) {
      tokenCount += encodeSkillProse(
        encoding,
        run.slice(index, index + LONG_UNBROKEN_TEXT_CHUNK_SIZE),
      ).length;
    }
    cursor = matchIndex + run.length;
  }

  if (cursor < text.length) {
    tokenCount += encodeSkillProse(encoding, text.slice(cursor)).length;
  }

  return tokenCount;
}

function encodeSkillProse(encoding: TokenEncoding, text: string): number[] {
  // Treat reserved tokenizer spellings in skill prose as ordinary text.
  return encoding.encode(text, [], []);
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  const newlineMatches = text.match(/\r\n|\r|\n/g);
  const newlineCount = newlineMatches?.length ?? 0;
  return /(?:\r\n|\r|\n)$/.test(text) ? newlineCount : newlineCount + 1;
}
