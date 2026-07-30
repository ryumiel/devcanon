import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  MAX_PROTOCOL_MESSAGE_BYTES,
  ProcessProtocolError,
  ProtocolDecoder,
  decodeProtocolMessage,
  encodeProtocolMessage,
  frameProtocolMessage,
} from "./pr-review-process-protocol.js";
import type {
  ProcessProtocolMessage,
  ProtocolDecodeResult,
} from "./pr-review-process-protocol.js";

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

function frameRawPayload(payload: Uint8Array): Uint8Array {
  const framed = new Uint8Array(payload.length + 4);
  new DataView(framed.buffer).setUint32(0, payload.length, false);
  framed.set(payload, 4);
  return framed;
}

function exactLimitPayload(message: unknown): Uint8Array {
  const prefix = new TextDecoder().decode(rawMessage(message));
  return encoder.encode(
    `${prefix}${" ".repeat(MAX_PROTOCOL_MESSAGE_BYTES - encoder.encode(prefix).length)}`,
  );
}

function decodePartitions(
  framed: Uint8Array,
  ends: readonly number[],
): {
  messages: ProcessProtocolMessage[];
  error: ProcessProtocolError | undefined;
} {
  const decoder = new ProtocolDecoder();
  const messages: ProcessProtocolMessage[] = [];
  let error: ProcessProtocolError | undefined;
  let start = 0;
  for (const end of [...ends, framed.length]) {
    if (end === start) continue;
    const result = decoder.push(framed.subarray(start, end));
    messages.push(...result.messages);
    if (result.status === "fatal") {
      error = result.error;
      break;
    }
    start = end;
  }
  return { messages, error };
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
    const exact = exactLimitPayload(vectors.raw.exactLimitMessage);
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
    const framedDone = frameProtocolMessage(done);
    let constructorTrapCalls = 0;
    let speciesTrapCalls = 0;
    class ForgedBytes extends Uint8Array {
      static get [Symbol.species](): Uint8ArrayConstructor {
        speciesTrapCalls += 1;
        throw new Error("copy must not access Symbol.species");
      }

      get byteLength(): number {
        return done.byteLength;
      }

      get buffer(): ArrayBuffer {
        return done.buffer as ArrayBuffer;
      }
    }
    Object.defineProperty(ForgedBytes.prototype, "constructor", {
      get(): never {
        constructorTrapCalls += 1;
        throw new Error("copy must not access constructor");
      },
    });
    class ForgedTransport extends Uint8Array {
      static get [Symbol.species](): Uint8ArrayConstructor {
        speciesTrapCalls += 1;
        throw new Error("copy must not access Symbol.species");
      }

      get byteLength(): number {
        return framedDone.byteLength;
      }

      get buffer(): ArrayBuffer {
        return framedDone.buffer as ArrayBuffer;
      }
    }
    Object.defineProperty(ForgedTransport.prototype, "constructor", {
      get(): never {
        constructorTrapCalls += 1;
        throw new Error("copy must not access constructor");
      },
    });
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

    const forgedOversized = new ForgedBytes(MAX_PROTOCOL_MESSAGE_BYTES + 1);
    const oversizedDiagnostic = new ProcessProtocolError(
      "message exceeds 65,536 bytes",
    ).message;
    for (const admit of [
      () => encodeProtocolMessage(forgedOversized),
      () => frameProtocolMessage(forgedOversized),
      () => decodeProtocolMessage(forgedOversized),
    ]) {
      expect(admit).toThrowError(oversizedDiagnostic);
    }
    const forgedTransport = new ForgedTransport(MAX_PROTOCOL_MESSAGE_BYTES + 1);
    const transportDiagnostic = new ProcessProtocolError(
      "message is not fatal UTF-8 JSON",
    ).message;
    expect(new ProtocolDecoder().push(forgedTransport)).toMatchObject({
      status: "fatal",
      messages: [],
      error: { message: transportDiagnostic },
    });
    expect(constructorTrapCalls).toBe(0);
    expect(speciesTrapCalls).toBe(0);
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

  test("keeps exact-limit and malformed-suffix outcomes invariant across frame partitions", () => {
    const done = { type: "done", version: 1 };
    const exact = frameProtocolMessage(exactLimitPayload(done));
    const following = frameProtocolMessage(rawMessage(done));
    const joinedExact = join(exact, following);
    for (const ends of [
      [],
      [2, 4],
      [4, exact.length - 1, exact.length],
      [exact.length + 2],
    ]) {
      expect(decodePartitions(joinedExact, ends)).toEqual({
        messages: [done, done],
        error: undefined,
      });
    }

    const malformed = frameRawPayload(encoder.encode("{"));
    const joinedMalformed = join(following, malformed);
    let expectedError: string | undefined;
    for (const ends of [
      [],
      [2, 4],
      [following.length - 1, following.length],
      [following.length + 2, joinedMalformed.length - 1],
    ]) {
      const result = decodePartitions(joinedMalformed, ends);
      expect(result.messages).toEqual([done]);
      expect(result.error?.message).toMatch(/UTF-8 JSON|protocol/i);
      expectedError ??= result.error?.message;
      expect(result.error?.message).toBe(expectedError);
    }
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
