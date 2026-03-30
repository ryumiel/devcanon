import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { expandHome, resolveFromBase } from "./paths.js";

describe("expandHome", () => {
  it("replaces ~/path with homedir + path", () => {
    const result = expandHome("~/documents/foo");
    expect(result).toBe(path.join(os.homedir(), "documents/foo"));
  });

  it("replaces bare ~ with homedir", () => {
    const result = expandHome("~");
    expect(result).toBe(os.homedir());
  });

  it("returns absolute path unchanged", () => {
    const result = expandHome("/usr/local/bin");
    expect(result).toBe("/usr/local/bin");
  });

  it("returns relative path unchanged", () => {
    const result = expandHome("relative/path");
    expect(result).toBe("relative/path");
  });
});

describe("resolveFromBase", () => {
  it("resolves relative path from base", () => {
    const result = resolveFromBase("foo/bar", "/my/base");
    expect(result).toBe(path.resolve("/my/base", "foo/bar"));
  });

  it("returns normalized absolute path as-is", () => {
    const result = resolveFromBase("/absolute/path", "/my/base");
    expect(result).toBe(path.normalize("/absolute/path"));
  });

  it("expands ~ path and returns it (ignoring base)", () => {
    const result = resolveFromBase("~/some/path", "/my/base");
    expect(result).toBe(path.normalize(path.join(os.homedir(), "some/path")));
  });
});
