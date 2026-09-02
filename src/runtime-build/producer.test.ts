import { describe, expect, it } from "vitest";
import {
  canonicalInputSha256,
  canonicalizeDependencyProjection,
  renderThirdPartyLicenses,
} from "./producer.js";

describe("runtime provider canonical production", () => {
  it("sorts UTF-8 paths and frames records so concatenation collisions differ", () => {
    const first = canonicalInputSha256([
      { path: "ab", content: Buffer.from("c") },
      { path: "a", content: Buffer.from("bc") },
    ]);
    const second = canonicalInputSha256([
      { path: "a", content: Buffer.from("b") },
      { path: "ab", content: Buffer.from("c") },
    ]);

    expect(first).not.toBe(second);
    expect(
      canonicalInputSha256([
        { path: "z", content: Buffer.from("1") },
        { path: "é", content: Buffer.from("2") },
      ]),
    ).toBe(
      canonicalInputSha256([
        { path: "é", content: Buffer.from("2") },
        { path: "z", content: Buffer.from("1") },
      ]),
    );
  });

  it("rejects duplicate canonical records and duplicate complete dependency edges", () => {
    expect(() =>
      canonicalInputSha256([
        { path: "same", content: Buffer.from("a") },
        { path: "same", content: Buffer.from("b") },
      ]),
    ).toThrow(/duplicate canonical path/i);
    expect(() =>
      canonicalizeDependencyProjection([
        {
          id: "pkg@1(peer@1)",
          name: "pkg",
          version: "1.0.0",
          integrity: "sha512-example",
          dependencies: [
            {
              key: "peer",
              name: "peer",
              alias: "peer",
              kind: "dependencies",
              target_id: "peer@1",
            },
            {
              key: "peer",
              name: "peer",
              alias: "peer",
              kind: "dependencies",
              target_id: "peer@1",
            },
          ],
        },
      ]),
    ).toThrow(/duplicate dependency edge/i);
  });

  it("orders peer-distinct instances by canonical id and refuses missing attribution", () => {
    const projection = canonicalizeDependencyProjection([
      {
        id: "same@1(peer@b)",
        name: "same",
        version: "1.0.0",
        integrity: "sha512-b",
        dependencies: [],
      },
      {
        id: "same@1(peer@a)",
        name: "same",
        version: "1.0.0",
        integrity: "sha512-a",
        dependencies: [],
      },
    ]);
    const licenses = renderThirdPartyLicenses(
      projection,
      new Map([
        ["same@1(peer@a)", "A\r\nnotice\r\n"],
        ["same@1(peer@b)", "B\nnotice\n"],
      ]),
    );

    expect(licenses.toString()).toBe(
      "same@1(peer@a)\nA\nnotice\n\nsame@1(peer@b)\nB\nnotice\n",
    );
    expect(() => renderThirdPartyLicenses(projection, new Map())).toThrow(
      /missing attribution/i,
    );
  });
});
