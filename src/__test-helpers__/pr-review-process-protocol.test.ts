import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  MAX_PROTOCOL_MESSAGE_BYTES,
  ProtocolDecoder,
  decodeProtocolMessage,
  encodeProtocolMessage,
  frameProtocolMessage,
} from "./pr-review-process-protocol.js";

type ProtocolVectors = {
  valid: unknown[];
  malformed: unknown[];
  truncatedFrame: number[];
  overflowFrame: number[];
};

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "pr-review-process-protocol-v1.json",
);

async function readVectors(): Promise<ProtocolVectors> {
  return JSON.parse(await readFile(fixturePath, "utf8")) as ProtocolVectors;
}

describe("pr-review process protocol", () => {
  test("round trips each checked-in closed V1 message through length framing", async () => {
    const vectors = await readVectors();

    for (const message of vectors.valid) {
      const framed = frameProtocolMessage(message);
      expect(decodeProtocolMessage(framed.subarray(4))).toEqual(message);
      expect(new ProtocolDecoder().push(framed)).toEqual([message]);
    }
  });

  test("rejects malformed checked-in messages before accepting them as lifecycle evidence", async () => {
    const vectors = await readVectors();

    for (const message of vectors.malformed) {
      expect(() => encodeProtocolMessage(message)).toThrow(/protocol/i);
    }
  });

  test("keeps incomplete frames pending and rejects a declared payload above the byte ceiling", async () => {
    const vectors = await readVectors();
    const decoder = new ProtocolDecoder();

    expect(decoder.push(Uint8Array.from(vectors.truncatedFrame))).toEqual([]);
    expect(() => decoder.push(Uint8Array.from(vectors.overflowFrame))).toThrow(
      /65,536|protocol/i,
    );
  });

  test("rejects inputs above the intrinsic byte ceiling before JSON decoding", () => {
    const oversized = new Uint8Array(MAX_PROTOCOL_MESSAGE_BYTES + 1);

    expect(() => decodeProtocolMessage(oversized)).toThrow(/65,536|protocol/i);
  });

  test("is invariant to transport chunking", () => {
    const framed = frameProtocolMessage({
      type: "ready",
      version: 1,
      descendantPolicy: "cooperative",
    });
    const decoder = new ProtocolDecoder();

    expect(decoder.push(framed.subarray(0, 2))).toEqual([]);
    expect(decoder.push(framed.subarray(2, 7))).toEqual([]);
    expect(decoder.push(framed.subarray(7))).toEqual([
      { type: "ready", version: 1, descendantPolicy: "cooperative" },
    ]);
  });
});
