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
import type { ProtocolDecodeResult } from "./pr-review-process-protocol.js";

type FatalProtocolDecodeResult = Extract<
  ProtocolDecodeResult,
  { status: "fatal" }
>;

type ProtocolVectors = {
  valid: unknown[];
  malformed: unknown[];
  raw: {
    invalidUtf8: number[];
    invalidJson: string;
    truncatedHeader: number[];
    truncatedPayload: number[];
    overflowHeader: number[];
    exactLimitMessage: unknown;
  };
};

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "pr-review-process-protocol-v1.json",
);
const encoder = new TextEncoder();

async function readVectors(): Promise<ProtocolVectors> {
  return JSON.parse(await readFile(fixturePath, "utf8")) as ProtocolVectors;
}

function rawMessage(message: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(message));
}

function join(...values: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    values.reduce((size, value) => size + value.length, 0),
  );
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.length;
  }
  return result;
}

describe("pr-review process protocol", () => {
  test("round trips each checked-in closed V1 message through raw-byte framing", async () => {
    const vectors = await readVectors();

    for (const message of vectors.valid) {
      const raw = rawMessage(message);
      const framed = frameProtocolMessage(raw);
      expect(encodeProtocolMessage(raw)).toEqual(raw);
      expect(decodeProtocolMessage(framed.subarray(4))).toEqual(message);
      expect(new ProtocolDecoder().push(framed)).toEqual({
        status: "ok",
        messages: [message],
      });
    }
  });

  test("rejects malformed JSON messages before framing them as lifecycle evidence", async () => {
    const vectors = await readVectors();

    for (const message of vectors.malformed) {
      expect(() => frameProtocolMessage(rawMessage(message))).toThrow(
        /protocol/i,
      );
    }
    expect(() =>
      decodeProtocolMessage(Uint8Array.from(vectors.raw.invalidUtf8)),
    ).toThrow(/UTF-8|protocol/i);
    expect(() =>
      frameProtocolMessage(encoder.encode(vectors.raw.invalidJson)),
    ).toThrow(/UTF-8|protocol/i);
  });

  test("enforces the exact byte boundary before copying sender payload bytes", async () => {
    const vectors = await readVectors();
    const prefix = new TextDecoder().decode(
      rawMessage(vectors.raw.exactLimitMessage),
    );
    const exact = encoder.encode(
      `${prefix}${" ".repeat(MAX_PROTOCOL_MESSAGE_BYTES - encoder.encode(prefix).length)}`,
    );
    const oversized = new Uint8Array(MAX_PROTOCOL_MESSAGE_BYTES + 1);

    expect(exact).toHaveLength(MAX_PROTOCOL_MESSAGE_BYTES);
    expect(decodeProtocolMessage(exact)).toEqual(vectors.raw.exactLimitMessage);
    expect(frameProtocolMessage(exact)).toHaveLength(
      MAX_PROTOCOL_MESSAGE_BYTES + 4,
    );
    expect(() => encodeProtocolMessage(oversized)).toThrow(/65,536|protocol/i);
    expect(() => decodeProtocolMessage(oversized)).toThrow(/65,536|protocol/i);
  });

  test("uses intrinsic byte-view metadata and rejects non-ArrayBuffer and Proxy views", () => {
    const done = rawMessage({ type: "done", version: 1 });
    class ForgedBytes extends Uint8Array {
      get byteLength(): number {
        return 0;
      }

      get buffer(): ArrayBuffer {
        return new ArrayBuffer(0);
      }
    }
    const forged = new ForgedBytes(done);
    const offset = Buffer.concat([
      Buffer.from([0]),
      Buffer.from(done),
    ]).subarray(1);
    const shared = new Uint8Array(new SharedArrayBuffer(done.length));
    shared.set(done);
    const proxy = new Proxy(done, {}) as unknown as Uint8Array;

    expect(decodeProtocolMessage(forged)).toEqual({ type: "done", version: 1 });
    expect(decodeProtocolMessage(offset)).toEqual({ type: "done", version: 1 });
    for (const input of [shared, proxy]) {
      expect(() => decodeProtocolMessage(input)).toThrow(
        /ArrayBuffer|protocol/i,
      );
      expect(() => frameProtocolMessage(input)).toThrow(
        /ArrayBuffer|protocol/i,
      );
      expect(new ProtocolDecoder().push(input)).toMatchObject({
        status: "fatal",
        messages: [],
      });
    }
  });

  test("is invariant to coalescing and commits an accepted prefix exactly once", async () => {
    const vectors = await readVectors();
    const done = frameProtocolMessage(rawMessage({ type: "done", version: 1 }));
    const cancel = frameProtocolMessage(
      rawMessage({ type: "cancel", version: 1 }),
    );
    const coalesced = new ProtocolDecoder().push(join(done, cancel));
    expect(coalesced).toEqual({
      status: "ok",
      messages: [
        { type: "done", version: 1 },
        { type: "cancel", version: 1 },
      ],
    });

    const suffix = Uint8Array.from(vectors.raw.overflowHeader);
    const together = new ProtocolDecoder();
    const togetherResult = together.push(join(done, suffix));
    expect(togetherResult).toMatchObject({
      status: "fatal",
      messages: [{ type: "done", version: 1 }],
    });

    const partitioned = new ProtocolDecoder();
    expect(partitioned.push(done)).toEqual({
      status: "ok",
      messages: [{ type: "done", version: 1 }],
    });
    const partitionedFailure = partitioned.push(suffix);
    expect(partitionedFailure).toMatchObject({ status: "fatal", messages: [] });
    expect(
      (partitionedFailure as FatalProtocolDecodeResult).error.message,
    ).toBe((togetherResult as FatalProtocolDecodeResult).error.message);

    const later = together.push(done);
    expect(later).toMatchObject({ status: "fatal", messages: [] });
    expect((later as FatalProtocolDecodeResult).error).toBe(
      (togetherResult as FatalProtocolDecodeResult).error,
    );
  });

  test("fails closed at EOF and checks terminal state before inspecting later input", async () => {
    const vectors = await readVectors();
    for (const truncated of [
      vectors.raw.truncatedHeader,
      vectors.raw.truncatedPayload,
    ]) {
      const decoder = new ProtocolDecoder();
      expect(decoder.push(Uint8Array.from(truncated))).toEqual({
        status: "ok",
        messages: [],
      });
      const eof = decoder.finish();
      expect(eof).toMatchObject({ status: "fatal", messages: [] });
      const later = decoder.finish();
      expect(later).toMatchObject({ status: "fatal", messages: [] });
      expect((later as FatalProtocolDecodeResult).error).toBe(
        (eof as FatalProtocolDecodeResult).error,
      );
    }

    const decoder = new ProtocolDecoder();
    expect(decoder.finish()).toEqual({ status: "ok", messages: [] });
    const { proxy, revoke } = Proxy.revocable(
      rawMessage({ type: "done", version: 1 }),
      {},
    );
    revoke();
    const later = decoder.push(proxy as unknown as Uint8Array);
    expect(later).toMatchObject({ status: "fatal", messages: [] });
    expect((later as FatalProtocolDecodeResult).error.message).toMatch(
      /finished/i,
    );
  });
});
