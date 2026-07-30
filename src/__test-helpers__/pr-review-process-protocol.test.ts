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
  construction: {
    oversizedRejection: { byteLength: number };
    coalescedFrames: { messages: unknown[] };
    malformedSuffix: { prefix: unknown; payload: string };
    forgedProxyAdmission: {
      message: unknown;
      offsetPrefix: number[];
      rejectedKinds: ("shared-array-buffer" | "proxy")[];
    };
    partitions: {
      exactLimitThenFollowing: string[][];
      validThenMalformed: string[][];
    };
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

function resolvePartitions(
  anchors: Readonly<Record<string, number>>,
  recipes: readonly (readonly string[])[],
): number[][] {
  return recipes.map((recipe) =>
    recipe.map((name) => {
      const end = anchors[name];
      if (end === undefined)
        throw new Error(`unknown partition anchor: ${name}`);
      return end;
    }),
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
    const oversized = new Uint8Array(
      vectors.construction.oversizedRejection.byteLength,
    );

    expect(exact).toHaveLength(MAX_PROTOCOL_MESSAGE_BYTES);
    expect(oversized).toHaveLength(MAX_PROTOCOL_MESSAGE_BYTES + 1);
    expect(decodeProtocolMessage(exact)).toEqual(vectors.raw.exactLimitMessage);
    expect(frameProtocolMessage(exact)).toHaveLength(
      MAX_PROTOCOL_MESSAGE_BYTES + 4,
    );
    expect(() => encodeProtocolMessage(oversized)).toThrow(/65,536|protocol/i);
    expect(() => decodeProtocolMessage(oversized)).toThrow(/65,536|protocol/i);
  });

  test("uses intrinsic byte-view metadata and rejects non-ArrayBuffer and Proxy views", async () => {
    const vectors = await readVectors();
    const admission = vectors.construction.forgedProxyAdmission;
    const done = rawMessage(admission.message);
    const framedDone = frameProtocolMessage(done);
    let forgedByteLengthGetterCalls = 0;
    let forgedBufferGetterCalls = 0;
    let typedArrayConstructorTrapCalls = 0;
    let typedArraySpeciesTrapCalls = 0;
    let arrayBufferConstructorTrapCalls = 0;
    let arrayBufferSpeciesTrapCalls = 0;
    class ForgedBytes extends Uint8Array {
      get byteLength(): number {
        forgedByteLengthGetterCalls += 1;
        return done.byteLength;
      }

      get buffer(): ArrayBuffer {
        forgedBufferGetterCalls += 1;
        return done.buffer as ArrayBuffer;
      }
    }
    class ForgedOffsetBytes extends Uint8Array {
      get byteOffset(): number {
        return 0;
      }
    }
    class ForgedTransport extends Uint8Array {
      get byteLength(): number {
        return framedDone.byteLength;
      }

      get buffer(): ArrayBuffer {
        return framedDone.buffer as ArrayBuffer;
      }
    }
    class ForgedBacking extends ArrayBuffer {}

    const backing = new ForgedBacking(done.length);
    const forged = new ForgedBytes(backing);
    forged.set(done);
    const offsetPrefix = Uint8Array.from(admission.offsetPrefix);
    const offsetBacking = new ArrayBuffer(done.length + offsetPrefix.length);
    const offsetBytes = new Uint8Array(offsetBacking);
    offsetBytes.set(offsetPrefix);
    offsetBytes.set(done, offsetPrefix.length);
    const forgedOffset = new ForgedOffsetBytes(
      offsetBacking,
      offsetPrefix.length,
      done.length,
    );
    const forgedTransport = new ForgedTransport(
      vectors.construction.oversizedRejection.byteLength,
    );

    Object.defineProperty(ForgedBytes.prototype, "constructor", {
      get(): typeof ForgedBytes {
        typedArrayConstructorTrapCalls += 1;
        return ForgedBytes;
      },
    });
    Object.defineProperty(ForgedBytes, Symbol.species, {
      get(): Uint8ArrayConstructor {
        typedArraySpeciesTrapCalls += 1;
        throw new Error("copy must not access Symbol.species");
      },
    });
    Object.defineProperty(backing, "constructor", {
      get(): typeof ForgedBacking {
        arrayBufferConstructorTrapCalls += 1;
        return ForgedBacking;
      },
    });
    Object.defineProperty(ForgedBacking, Symbol.species, {
      get(): ArrayBufferConstructor {
        arrayBufferSpeciesTrapCalls += 1;
        throw new Error("copy must not access backing Symbol.species");
      },
    });
    Object.defineProperty(ForgedTransport.prototype, "constructor", {
      get(): typeof ForgedTransport {
        typedArrayConstructorTrapCalls += 1;
        return ForgedTransport;
      },
    });
    Object.defineProperty(ForgedTransport, Symbol.species, {
      get(): Uint8ArrayConstructor {
        typedArraySpeciesTrapCalls += 1;
        throw new Error("copy must not access Symbol.species");
      },
    });

    const offset = Buffer.concat([
      Buffer.from([0]),
      Buffer.from(done),
    ]).subarray(1);
    const shared = new Uint8Array(new SharedArrayBuffer(done.length));
    shared.set(done);
    const proxy = new Proxy(done, {}) as unknown as Uint8Array;
    const rejectedInputs = admission.rejectedKinds.map((kind) => {
      if (kind === "shared-array-buffer") return shared;
      if (kind === "proxy") return proxy;
      throw new Error(`unknown forged admission kind: ${kind}`);
    });

    expect(encodeProtocolMessage(forged)).toEqual(done);
    expect(frameProtocolMessage(forged)).toEqual(framedDone);
    expect(forgedByteLengthGetterCalls).toBe(0);
    expect(forgedBufferGetterCalls).toBe(0);
    expect(decodeProtocolMessage(forged)).toEqual(admission.message);
    expect(encodeProtocolMessage(forgedOffset)).toEqual(done);
    expect(frameProtocolMessage(forgedOffset)).toEqual(framedDone);
    expect(decodeProtocolMessage(forgedOffset)).toEqual(admission.message);
    expect(decodeProtocolMessage(offset)).toEqual(admission.message);
    for (const input of rejectedInputs) {
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

    const forgedOversized = new ForgedBytes(
      vectors.construction.oversizedRejection.byteLength,
    );
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
    const transportDiagnostic = new ProcessProtocolError(
      "message is not fatal UTF-8 JSON",
    ).message;
    expect(new ProtocolDecoder().push(forgedTransport)).toMatchObject({
      status: "fatal",
      messages: [],
      error: { message: transportDiagnostic },
    });
    expect(typedArrayConstructorTrapCalls).toBe(0);
    expect(typedArraySpeciesTrapCalls).toBe(0);
    expect(arrayBufferConstructorTrapCalls).toBe(0);
    expect(arrayBufferSpeciesTrapCalls).toBe(0);
    expect(forgedByteLengthGetterCalls).toBe(0);
    expect(forgedBufferGetterCalls).toBe(0);
  });

  test("is invariant to coalescing and commits an accepted prefix exactly once", async () => {
    const vectors = await readVectors();
    const [doneMessage, cancelMessage] =
      vectors.construction.coalescedFrames.messages;
    const done = frameProtocolMessage(rawMessage(doneMessage));
    const cancel = frameProtocolMessage(rawMessage(cancelMessage));
    const coalesced = new ProtocolDecoder().push(join(done, cancel));
    expect(coalesced).toEqual({
      status: "ok",
      messages: [doneMessage, cancelMessage],
    });

    const suffix = Uint8Array.from(vectors.raw.overflowHeader);
    const together = new ProtocolDecoder();
    const togetherResult = together.push(join(done, suffix));
    expect(togetherResult).toMatchObject({
      status: "fatal",
      messages: [doneMessage],
    });

    const partitioned = new ProtocolDecoder();
    expect(partitioned.push(done)).toEqual({
      status: "ok",
      messages: [doneMessage],
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

  test("keeps exact-limit and malformed-suffix outcomes invariant across frame partitions", async () => {
    const vectors = await readVectors();
    const done = vectors.raw.exactLimitMessage;
    const exact = frameProtocolMessage(exactLimitPayload(done));
    const following = frameProtocolMessage(rawMessage(done));
    const joinedExact = join(exact, following);
    const exactPartitions = resolvePartitions(
      {
        headerStart: 2,
        headerEnd: 4,
        exactBeforeEnd: exact.length - 1,
        exactEnd: exact.length,
        followingHeaderStart: exact.length + 2,
      },
      vectors.construction.partitions.exactLimitThenFollowing,
    );
    for (const ends of exactPartitions) {
      expect(decodePartitions(joinedExact, ends)).toEqual({
        messages: [done, done],
        error: undefined,
      });
    }

    const malformedPrefix = vectors.construction.malformedSuffix.prefix;
    const malformedFollowing = frameProtocolMessage(
      rawMessage(malformedPrefix),
    );
    const malformed = frameRawPayload(
      encoder.encode(vectors.construction.malformedSuffix.payload),
    );
    const joinedMalformed = join(malformedFollowing, malformed);
    let expectedError: string | undefined;
    const malformedPartitions = resolvePartitions(
      {
        headerStart: 2,
        headerEnd: 4,
        validBeforeEnd: malformedFollowing.length - 1,
        validEnd: malformedFollowing.length,
        malformedHeaderStart: malformedFollowing.length + 2,
        joinedBeforeEnd: joinedMalformed.length - 1,
      },
      vectors.construction.partitions.validThenMalformed,
    );
    for (const ends of malformedPartitions) {
      const result = decodePartitions(joinedMalformed, ends);
      expect(result.messages).toEqual([malformedPrefix]);
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
