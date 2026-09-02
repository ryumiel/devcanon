import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cleanupTempDir, createTempDir } from "../__test-helpers__/fixtures.js";
import {
  canonicalInputSha256,
  canonicalizeDependencyProjection,
  extractPnpmProjection,
  publishVerifiedProvider,
  renderThirdPartyLicenses,
  verifySourceProvider,
} from "./producer.js";
import { PROVIDER_LEAVES, sha256 } from "./provider.js";

describe("runtime provider canonical production", () => {
  it("restores a prior provider and removes a rejected first publication", async () => {
    const root = await createTempDir();
    try {
      const destination = path.join(root, "provider");
      await writeProvider(destination);
      const stage = await createRejectedStage(root);
      await expect(
        publishVerifiedProvider({
          stage,
          destination,
          origin: "package",
          devcanonVersion: "2.0.0",
          inputSha256: "a".repeat(64),
        }),
      ).rejects.toThrow();
      expect(
        await readFile(path.join(destination, PROVIDER_LEAVES.bundle), "utf8"),
      ).toBe("export {};\n");

      const firstDestination = path.join(root, "first-provider");
      const firstStage = await createRejectedStage(root);
      await expect(
        publishVerifiedProvider({
          stage: firstStage,
          destination: firstDestination,
          origin: "package",
          devcanonVersion: "2.0.0",
          inputSha256: "a".repeat(64),
        }),
      ).rejects.toThrow();
      await expect(readFile(firstDestination)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await cleanupTempDir(root);
    }
  });
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

  it("preserves peer identities, aliases, optional edges, and the root importer from lock data", () => {
    const projection = extractPnpmProjection(`
importers:
  .:
    dependencies:
      alias:
        version: real@1.0.0(peer@1.0.0)
packages:
  real@1.0.0(peer@1.0.0):
    resolution: {integrity: sha512-real}
  peer@1.0.0:
    resolution: {integrity: sha512-peer}
snapshots:
  real@1.0.0(peer@1.0.0):
    optionalDependencies:
      peer: 1.0.0
  peer@1.0.0: {}
`);

    expect(projection.packages.map((item) => item.id)).toEqual([
      "peer@1.0.0",
      "real@1.0.0(peer@1.0.0)",
    ]);
    expect(projection.root).toEqual([
      {
        key: "alias",
        name: "real",
        alias: "alias",
        kind: "dependencies",
        target_id: "real@1.0.0(peer@1.0.0)",
      },
    ]);
    expect(projection.packages[1].dependencies).toEqual([
      {
        key: "peer",
        name: "peer",
        alias: "peer",
        kind: "optionalDependencies",
        target_id: "peer@1.0.0",
      },
    ]);
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
    expect(() =>
      renderThirdPartyLicenses(
        projection,
        new Map([
          ["same@1(peer@a)", "A"],
          ["same@1(peer@b)", "B"],
          ["unknown@1", "not allowed"],
        ]),
      ),
    ).toThrow(/unknown attribution/i);
  });
});

async function createRejectedStage(root: string): Promise<string> {
  const stage = path.join(root, `stage-${Math.random()}`);
  await mkdir(stage);
  return stage;
}

async function writeProvider(root: string): Promise<void> {
  await mkdir(root);
  const bundle = Buffer.from("export {};\n");
  const licenses = Buffer.from("license\n");
  await writeFile(path.join(root, PROVIDER_LEAVES.bundle), bundle);
  await writeFile(path.join(root, PROVIDER_LEAVES.licenses), licenses);
  await writeFile(
    path.join(root, PROVIDER_LEAVES.manifest),
    `${JSON.stringify({ schema: "devcanon-runtime-build/v1", devcanon_version: "2.0.0", artifact_origin: "package", input_sha256: "a".repeat(64), bundle_sha256: sha256(bundle), licenses_sha256: sha256(licenses), node_target: "node24" })}\n`,
  );
}
