import { describe, expect, it } from "vitest";
import {
  gitPathPairKey,
  isRepoPathIdentity,
  parseGitChangedFilesZ,
  parseGitNameStatusZ,
  parseGitNumstatZ,
} from "./git-diff-parser.js";

describe("git diff parser", () => {
  it("parses tabbed and newline paths without whitespace splitting", () => {
    expect(
      parseGitChangedFilesZ(
        Buffer.from("src/with\ttab.ts\0src/with\nline.ts\0"),
      ),
    ).toEqual(["src/with\ttab.ts", "src/with\nline.ts"]);
    expect(
      parseGitNameStatusZ(
        Buffer.from("M\0src/with\ttab.ts\0A\0src/with\nline.ts\0"),
      ),
    ).toEqual([
      { path: "src/with\ttab.ts", previousPath: null, status: "modified" },
      { path: "src/with\nline.ts", previousPath: null, status: "added" },
    ]);
    expect(parseGitNumstatZ(Buffer.from("1\t2\tsrc/with\ttab.ts\0"))).toEqual([
      {
        path: "src/with\ttab.ts",
        previousPath: null,
        additions: 1,
        deletions: 2,
        patchAvailable: true,
      },
    ]);
  });

  it("parses rename and copy tuples", () => {
    expect(
      parseGitNameStatusZ(
        Buffer.from("R100\0src/old.ts\0src/new.ts\0C075\0src/a.ts\0src/b.ts\0"),
      ),
    ).toEqual([
      { path: "src/new.ts", previousPath: "src/old.ts", status: "renamed" },
      { path: "src/b.ts", previousPath: "src/a.ts", status: "copied" },
    ]);
    expect(
      parseGitNumstatZ(Buffer.from("3\t4\t\0src/old.ts\0src/new.ts\0")),
    ).toEqual([
      {
        path: "src/new.ts",
        previousPath: "src/old.ts",
        additions: 3,
        deletions: 4,
        patchAvailable: true,
      },
    ]);
  });

  it("maps type-change records to modified", () => {
    expect(parseGitNameStatusZ(Buffer.from("T\0src/app.ts\0"))).toEqual([
      { path: "src/app.ts", previousPath: null, status: "modified" },
    ]);
  });

  it("parses binary numstat records as unavailable patches", () => {
    expect(parseGitNumstatZ(Buffer.from("-\t-\tassets/blob.bin\0"))).toEqual([
      {
        path: "assets/blob.bin",
        previousPath: null,
        additions: 0,
        deletions: 0,
        patchAvailable: false,
      },
    ]);
  });

  it.each([
    {
      name: "changed-file output without trailing NUL",
      parse: () => parseGitChangedFilesZ(Buffer.from("src/app.ts")),
      message: "malformed git changed files output",
    },
    {
      name: "name-status missing path token",
      parse: () => parseGitNameStatusZ(Buffer.from("M\0")),
      message: "malformed git name-status output",
    },
    {
      name: "name-status unsupported status header",
      parse: () => parseGitNameStatusZ(Buffer.from("X\0src/app.ts\0")),
      message: "malformed git name-status output",
    },
    {
      name: "name-status malformed rename score",
      parse: () => parseGitNameStatusZ(Buffer.from("R\0old\0new\0")),
      message: "malformed git name-status output",
    },
    {
      name: "name-status non-numeric rename score",
      parse: () => parseGitNameStatusZ(Buffer.from("Rabc\0old\0new\0")),
      message: "malformed git name-status output",
    },
    {
      name: "name-status malformed copy score",
      parse: () => parseGitNameStatusZ(Buffer.from("C\0old\0new\0")),
      message: "malformed git name-status output",
    },
    {
      name: "name-status non-numeric copy score",
      parse: () => parseGitNameStatusZ(Buffer.from("Cabc\0old\0new\0")),
      message: "malformed git name-status output",
    },
    {
      name: "rename missing current path token",
      parse: () => parseGitNameStatusZ(Buffer.from("R100\0src/old.ts\0")),
      message: "malformed git name-status output",
    },
    {
      name: "numstat missing second tab",
      parse: () => parseGitNumstatZ(Buffer.from("1\tsrc/app.ts\0")),
      message: "malformed git numstat output",
    },
    {
      name: "numstat invalid additions",
      parse: () => parseGitNumstatZ(Buffer.from("one\t2\tsrc/app.ts\0")),
      message: "malformed git numstat output",
    },
    {
      name: "numstat invalid deletions",
      parse: () => parseGitNumstatZ(Buffer.from("1\t-2\tsrc/app.ts\0")),
      message: "malformed git numstat output",
    },
    {
      name: "numstat incomplete rename tuple",
      parse: () => parseGitNumstatZ(Buffer.from("1\t2\t\0src/old.ts\0")),
      message: "malformed git numstat output",
    },
    {
      name: "empty token from embedded NUL-shaped path",
      parse: () => parseGitChangedFilesZ(Buffer.from("src/app.ts\0\0")),
      message: "malformed git changed files output",
    },
    {
      name: "invalid UTF-8 path bytes",
      parse: () => parseGitChangedFilesZ(Buffer.from([0xff, 0x00])),
      message: "invalid UTF-8 in git changed files output",
    },
  ])("rejects malformed parser input: $name", ({ parse, message }) => {
    expect(parse).toThrow(message);
  });

  it("rejects duplicate numstat path-pair metadata keys", () => {
    expect(() =>
      parseGitNumstatZ(
        Buffer.from("1\t0\tsrc/app.ts\0" + "2\t0\tsrc/app.ts\0"),
      ),
    ).toThrow("duplicate git numstat metadata key");
  });

  it("rejects NUL strings before path-pair keying", () => {
    expect(() =>
      gitPathPairKey({ path: "src/app.ts\0spoof", previousPath: null }),
    ).toThrow("path identity contains NUL");
    expect(isRepoPathIdentity("src/app.ts\0spoof")).toBe(false);
  });
});
