import { Buffer } from "node:buffer";

export const GPT_TOKEN_ESTIMATE_ENCODING = "o200k_base";
export const SKILL_PROMPT_TOKEN_WARNING_THRESHOLD = 8000;

interface TokenMetrics {
  estimatedTokens: number;
  encoding: typeof GPT_TOKEN_ESTIMATE_ENCODING;
  bytes: number;
  lines: number;
}

interface TokenEncoding {
  encode(text: string): unknown[];
}

let encodingPromise: Promise<TokenEncoding> | undefined;

export async function measureSkillPrompt(text: string): Promise<TokenMetrics> {
  const encoding = await getTokenEncoding();
  return {
    estimatedTokens: encoding.encode(text).length,
    encoding: GPT_TOKEN_ESTIMATE_ENCODING,
    bytes: Buffer.byteLength(text, "utf-8"),
    lines: countLines(text),
  };
}

async function getTokenEncoding(): Promise<TokenEncoding> {
  encodingPromise ??= import("js-tiktoken").then(({ getEncoding }) =>
    getEncoding(GPT_TOKEN_ESTIMATE_ENCODING),
  );
  return encodingPromise;
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  return text.split(/\r\n|\r|\n/).length;
}
