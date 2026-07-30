const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayByteLength = requiredGetter<() => number>(
  typedArrayPrototype,
  "byteLength",
);
const typedArrayByteOffset = requiredGetter<() => number>(
  typedArrayPrototype,
  "byteOffset",
);
const typedArrayBuffer = requiredGetter<() => ArrayBuffer>(
  typedArrayPrototype,
  "buffer",
);
const uint8ArrayTag = requiredGetter<() => string>(
  typedArrayPrototype,
  Symbol.toStringTag,
);
const arrayBufferByteLength = requiredGetter<() => number>(
  ArrayBuffer.prototype,
  "byteLength",
);

export const MAX_PROTOCOL_MESSAGE_BYTES = 65_536;
const FRAME_HEADER_BYTES = 4;

export type DescendantPolicy = "none" | "cooperative";
export type DiagnosticCode =
  | "fixture_note"
  | "descendant_evidence_contradictory";

export type ProcessProtocolMessage =
  | { type: "ready"; version: 1; descendantPolicy: DescendantPolicy }
  | { type: "done"; version: 1 }
  | { type: "cancel"; version: 1 }
  | { type: "descendants_stopped"; version: 1 }
  | { type: "diagnostic"; version: 1; code: DiagnosticCode };

export type ProtocolDecodeResult =
  | {
      readonly status: "ok";
      readonly messages: readonly ProcessProtocolMessage[];
    }
  | {
      readonly status: "fatal";
      readonly messages: readonly ProcessProtocolMessage[];
      readonly error: ProcessProtocolError;
    };

type CapturedByteView = {
  readonly buffer: ArrayBuffer;
  readonly byteOffset: number;
  readonly byteLength: number;
};

export class ProcessProtocolError extends Error {
  constructor(message: string) {
    super(`Invalid cooperative command protocol: ${message}`);
    this.name = "ProcessProtocolError";
  }
}

/**
 * Validates and snapshots a bounded sender payload. The sender boundary is raw
 * bytes so this helper never validates and later serializes the same object.
 */
export function encodeProtocolMessage(value: Uint8Array): Uint8Array {
  const captured = captureByteView(value);
  assertMessageByteLength(captured.byteLength);
  const bytes = copyCapturedSpan(captured);
  decodeCapturedProtocolMessage(captureByteView(bytes));
  return bytes;
}

export function decodeProtocolMessage(
  value: Uint8Array,
): ProcessProtocolMessage {
  const captured = captureByteView(value);
  assertMessageByteLength(captured.byteLength);
  return decodeCapturedProtocolMessage(captured);
}

export function frameProtocolMessage(value: Uint8Array): Uint8Array {
  const payload = encodeProtocolMessage(value);
  const framed = new Uint8Array(FRAME_HEADER_BYTES + payload.length);
  new DataView(framed.buffer).setUint32(0, payload.length, false);
  framed.set(payload, FRAME_HEADER_BYTES);
  return framed;
}

/** A bounded incremental decoder for one private protocol channel. */
export class ProtocolDecoder {
  #header = new Uint8Array(FRAME_HEADER_BYTES);
  #headerLength = 0;
  #payload: Uint8Array | undefined;
  #payloadLength = 0;
  #terminal: ProcessProtocolError | undefined;

  push(chunk: Uint8Array): ProtocolDecodeResult {
    const terminal = this.#terminalResult();
    if (terminal) return terminal;

    let captured: CapturedByteView;
    try {
      captured = captureByteView(chunk);
    } catch (error) {
      return this.#fatal(error, []);
    }

    const messages: ProcessProtocolMessage[] = [];
    let offset = 0;
    try {
      while (true) {
        if (this.#headerLength < FRAME_HEADER_BYTES) {
          if (offset === captured.byteLength) break;
          const count = Math.min(
            FRAME_HEADER_BYTES - this.#headerLength,
            captured.byteLength - offset,
          );
          copyCapturedRange(
            captured,
            offset,
            this.#header,
            this.#headerLength,
            count,
          );
          offset += count;
          this.#headerLength += count;
          if (this.#headerLength < FRAME_HEADER_BYTES) break;

          const payloadLength = new DataView(this.#header.buffer).getUint32(
            0,
            false,
          );
          assertMessageByteLength(payloadLength);
          this.#payload = new Uint8Array(payloadLength);
          this.#payloadLength = 0;
        }

        const payload = this.#payload;
        if (!payload) {
          throw new ProcessProtocolError("decoder has no declared payload");
        }
        if (this.#payloadLength < payload.length) {
          if (offset === captured.byteLength) break;
          const count = Math.min(
            payload.length - this.#payloadLength,
            captured.byteLength - offset,
          );
          copyCapturedRange(
            captured,
            offset,
            payload,
            this.#payloadLength,
            count,
          );
          offset += count;
          this.#payloadLength += count;
          if (this.#payloadLength < payload.length) break;
        }

        messages.push(decodeCapturedProtocolMessage(captureByteView(payload)));
        this.#headerLength = 0;
        this.#payload = undefined;
        this.#payloadLength = 0;
      }
    } catch (error) {
      return this.#fatal(error, messages);
    }

    return { status: "ok", messages };
  }

  finish(): ProtocolDecodeResult {
    const terminal = this.#terminalResult();
    if (terminal) return terminal;
    if (this.#headerLength !== 0 || this.#payloadLength !== 0) {
      return this.#fatal(
        new ProcessProtocolError("channel ended with a truncated frame"),
        [],
      );
    }
    this.#terminal = new ProcessProtocolError("decoder is already finished");
    return { status: "ok", messages: [] };
  }

  #fatal(
    error: unknown,
    messages: readonly ProcessProtocolMessage[],
  ): ProtocolDecodeResult {
    const protocolError = toProtocolError(error);
    this.#terminal = protocolError;
    return { status: "fatal", messages, error: protocolError };
  }

  #terminalResult(): ProtocolDecodeResult | undefined {
    if (!this.#terminal) return undefined;
    return { status: "fatal", messages: [], error: this.#terminal };
  }
}

function captureByteView(value: unknown): CapturedByteView {
  try {
    if (Reflect.apply(uint8ArrayTag, value, []) !== "Uint8Array") {
      throw new ProcessProtocolError(
        "input must be an ArrayBuffer-backed Uint8Array",
      );
    }
    const buffer = Reflect.apply(typedArrayBuffer, value, []);
    const byteOffset = Reflect.apply(typedArrayByteOffset, value, []);
    const byteLength = Reflect.apply(typedArrayByteLength, value, []);
    const backingLength = Reflect.apply(arrayBufferByteLength, buffer, []);
    if (
      !Number.isSafeInteger(byteOffset) ||
      !Number.isSafeInteger(byteLength) ||
      byteOffset < 0 ||
      byteLength < 0 ||
      byteOffset > backingLength - byteLength
    ) {
      throw new ProcessProtocolError(
        "input has invalid intrinsic byte metadata",
      );
    }
    return { buffer: buffer as ArrayBuffer, byteOffset, byteLength };
  } catch (error) {
    throw toProtocolError(
      error,
      "input must be an ArrayBuffer-backed Uint8Array",
    );
  }
}

function copyCapturedSpan(captured: CapturedByteView): Uint8Array {
  const copy = new Uint8Array(captured.byteLength);
  copyCapturedRange(captured, 0, copy, 0, captured.byteLength);
  return copy;
}

function copyCapturedRange(
  captured: CapturedByteView,
  sourceOffset: number,
  target: Uint8Array,
  targetOffset: number,
  count: number,
): void {
  const source = new Uint8Array(
    captured.buffer,
    captured.byteOffset + sourceOffset,
    count,
  );
  target.set(source, targetOffset);
}

function decodeCapturedProtocolMessage(
  captured: CapturedByteView,
): ProcessProtocolMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      decoder.decode(
        new Uint8Array(
          captured.buffer,
          captured.byteOffset,
          captured.byteLength,
        ),
      ),
    );
  } catch {
    throw new ProcessProtocolError("message is not fatal UTF-8 JSON");
  }
  return validateProtocolMessage(parsed);
}

function assertMessageByteLength(length: number): void {
  if (
    !Number.isInteger(length) ||
    length < 0 ||
    length > MAX_PROTOCOL_MESSAGE_BYTES
  ) {
    throw new ProcessProtocolError("message exceeds 65,536 bytes");
  }
}

function validateProtocolMessage(value: unknown): ProcessProtocolMessage {
  if (
    !isPlainRecord(value) ||
    value.version !== 1 ||
    typeof value.type !== "string"
  ) {
    throw new ProcessProtocolError("message must be a V1 object");
  }

  switch (value.type) {
    case "ready":
      assertExactKeys(value, ["type", "version", "descendantPolicy"]);
      if (
        value.descendantPolicy !== "none" &&
        value.descendantPolicy !== "cooperative"
      ) {
        throw new ProcessProtocolError(
          "ready has an invalid descendant policy",
        );
      }
      return value as ProcessProtocolMessage;
    case "done":
    case "cancel":
    case "descendants_stopped":
      assertExactKeys(value, ["type", "version"]);
      return value as ProcessProtocolMessage;
    case "diagnostic":
      assertExactKeys(value, ["type", "version", "code"]);
      if (
        value.code !== "fixture_note" &&
        value.code !== "descendant_evidence_contradictory"
      ) {
        throw new ProcessProtocolError("diagnostic has an unknown code");
      }
      return value as ProcessProtocolMessage;
    default:
      throw new ProcessProtocolError("message has an unknown type");
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: string[],
): void {
  const keys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new ProcessProtocolError("message has unknown or missing fields");
  }
}

function requiredGetter<Getter extends () => unknown>(
  target: object,
  key: PropertyKey,
): Getter {
  const getter = Object.getOwnPropertyDescriptor(target, key)?.get;
  if (!getter) throw new Error(`missing intrinsic getter for ${String(key)}`);
  return getter as Getter;
}

function toProtocolError(
  error: unknown,
  fallback?: string,
): ProcessProtocolError {
  if (error instanceof ProcessProtocolError) return error;
  return new ProcessProtocolError(fallback ?? "invalid input");
}
