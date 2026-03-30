import { describe, expect, it } from "vitest";
import { sha256 } from "./hash.js";

describe("sha256", () => {
  it("produces a consistent hash for the same input", () => {
    const hash1 = sha256("hello world");
    const hash2 = sha256("hello world");
    expect(hash1).toBe(hash2);
  });

  it("produces a 64-character hex string", () => {
    const hash = sha256("test");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces different hashes for different inputs", () => {
    const hash1 = sha256("input-a");
    const hash2 = sha256("input-b");
    expect(hash1).not.toBe(hash2);
  });
});
