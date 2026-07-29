const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export const MAX_PROTOCOL_MESSAGE_BYTES = 65_536;
const FRAME_HEADER_BYTES = 4;

export type DescendantPolicy = "none" | "cooperative";

export type ProcessProtocolMessage =
  | { type: "ready"; version: 1; descendantPolicy: DescendantPolicy }
  | { type: "done"; version: 1 }
  | { type: "cancel"; version: 1 }
  | { type: "descendants_stopped"; version: 1 }
  | { type: "diagnostic"; version: 1; code: "fixture_note" };

export class ProcessProtocolError extends Error {
  constructor(message: string) {
    super(`Invalid cooperative command protocol: ${message}`);
    this.name = "ProcessProtocolError";
  }
}

export function encodeProtocolMessage(value: unknown): Uint8Array {
  const message = validateProtocolMessage(value);
  const bytes = encoder.encode(JSON.stringify(message));
  assertMessageByteLength(bytes.byteLength);
  return bytes;
}

export function decodeProtocolMessage(
  value: Uint8Array,
): ProcessProtocolMessage {
  assertByteView(value);
  assertMessageByteLength(value.byteLength);

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(value));
  } catch {
    throw new ProcessProtocolError("message is not fatal UTF-8 JSON");
  }
  return validateProtocolMessage(parsed);
}

export function frameProtocolMessage(value: unknown): Uint8Array {
  const payload = encodeProtocolMessage(value);
  const framed = new Uint8Array(FRAME_HEADER_BYTES + payload.byteLength);
  new DataView(framed.buffer).setUint32(0, payload.byteLength, false);
  framed.set(payload, FRAME_HEADER_BYTES);
  return framed;
}

/** A bounded four-byte-length decoder for one private protocol channel. */
export class ProtocolDecoder {
  #pending = new Uint8Array();

  push(chunk: Uint8Array): ProcessProtocolMessage[] {
    assertByteView(chunk);
    if (chunk.byteLength > MAX_PROTOCOL_MESSAGE_BYTES + FRAME_HEADER_BYTES) {
      throw new ProcessProtocolError("framed input exceeds the bounded window");
    }

    const joinedLength = this.#pending.byteLength + chunk.byteLength;
    if (joinedLength > MAX_PROTOCOL_MESSAGE_BYTES + FRAME_HEADER_BYTES) {
      throw new ProcessProtocolError("framed input exceeds the bounded window");
    }

    const joined = new Uint8Array(joinedLength);
    joined.set(this.#pending);
    joined.set(chunk, this.#pending.byteLength);
    this.#pending = joined;

    const messages: ProcessProtocolMessage[] = [];
    let offset = 0;
    while (this.#pending.byteLength - offset >= FRAME_HEADER_BYTES) {
      const length = new DataView(
        this.#pending.buffer,
        this.#pending.byteOffset + offset,
        FRAME_HEADER_BYTES,
      ).getUint32(0, false);
      assertMessageByteLength(length);

      const frameEnd = offset + FRAME_HEADER_BYTES + length;
      if (frameEnd > this.#pending.byteLength) break;
      messages.push(
        decodeProtocolMessage(
          this.#pending.subarray(offset + FRAME_HEADER_BYTES, frameEnd),
        ),
      );
      offset = frameEnd;
    }

    this.#pending = this.#pending.slice(offset);
    return messages;
  }
}

function assertByteView(value: Uint8Array): void {
  if (
    !(value instanceof Uint8Array) ||
    !(value.buffer instanceof ArrayBuffer)
  ) {
    throw new ProcessProtocolError(
      "input must be an ArrayBuffer-backed Uint8Array",
    );
  }
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
      if (value.code !== "fixture_note") {
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
