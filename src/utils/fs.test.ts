import { describe, expect, it } from "vitest";
import { isNodeErrorCode, isUnobservableSymlinkTargetError } from "./fs.js";

function nodeError(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

describe("filesystem error helpers", () => {
  it("classifies unobservable symlink target errors", () => {
    for (const code of ["ENOENT", "ELOOP", "EPERM", "EACCES"]) {
      expect(isUnobservableSymlinkTargetError(nodeError(code))).toBe(true);
    }
    expect(isUnobservableSymlinkTargetError(nodeError("EIO"))).toBe(false);
  });

  it("matches node error codes exactly", () => {
    expect(isNodeErrorCode(nodeError("ENOENT"), "ENOENT")).toBe(true);
    expect(isNodeErrorCode(nodeError("EACCES"), "EPERM")).toBe(false);
    expect(isNodeErrorCode(new Error("ENOENT"), "ENOENT")).toBe(false);
  });
});
