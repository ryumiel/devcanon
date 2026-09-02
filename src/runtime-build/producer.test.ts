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
  resolveLockInstances,
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

  it("selects bundled package records before unrelated malformed lock edges", () => {
    expect(() =>
      extractPnpmProjection(
        `
importers:
  .:
    dependencies:
      real: {version: 1.0.0}
packages:
  real@1.0.0: {resolution: {integrity: sha512-real}}
  broken@1.0.0: {resolution: {integrity: sha512-broken}}
snapshots:
  real@1.0.0: {}
  broken@1.0.0:
    dependencies: {missing: 1.0.0}
`,
        [{ name: "real", version: "1.0.0" }],
      ),
    ).not.toThrow();
  });

  it("rejects a requested bundled package that has no snapshot", () => {
    expect(() =>
      extractPnpmProjection(
        `
packages:
  real@1.0.0: {resolution: {integrity: sha512-real}}
snapshots:
  real@1.0.0: {}
`,
        [{ name: "missing", version: "9.9.9" }],
      ),
    ).toThrow(/no lockfile package instance/i);
  });

  it("retains selected physical peer ids instead of reselecting same-version peers", () => {
    expect(
      extractPnpmProjection(
        `
importers:
  .:
    dependencies:
      same-a: {version: same@1.0.0(peer-a@1.0.0)}
packages:
  same@1.0.0(peer-a@1.0.0): {resolution: {integrity: sha512-same-a}}
  same@1.0.0(peer-b@1.0.0): {resolution: {integrity: sha512-same-b}}
snapshots:
  same@1.0.0(peer-a@1.0.0): {}
  same@1.0.0(peer-b@1.0.0):
    dependencies: {missing: 1.0.0}
`,
        undefined,
        new Set(["same@1.0.0(peer-a@1.0.0)"]),
      ),
    ).toMatchObject({
      packages: [expect.objectContaining({ id: "same@1.0.0(peer-a@1.0.0)" })],
    });
  });

  it("rejects an unresolved edge in the selected bundled closure", () => {
    expect(() =>
      extractPnpmProjection(
        `
importers:
  .:
    dependencies:
      real: {version: 1.0.0}
packages:
  real@1.0.0: {resolution: {integrity: sha512-real}}
  broken@1.0.0: {resolution: {integrity: sha512-broken}}
snapshots:
  real@1.0.0:
    dependencies: {missing: 1.0.0}
  broken@1.0.0:
    dependencies: {also-missing: 1.0.0}
`,
        [{ name: "real", version: "1.0.0" }],
      ),
    ).toThrow(/unresolved lockfile dependency edge: real@1.0.0/i);
  });

  it("reconciles peer-qualified bundled instances through their physical pnpm roots", async () => {
    const root = await createTempDir();
    try {
      await writeFile(
        path.join(root, "pnpm-lock.yaml"),
        `
importers:
  .:
    dependencies:
      same-a: {version: same@1.0.0(peer-a@1.0.0)}
      same-b: {version: same@1.0.0(peer-b@1.0.0)}
packages:
  same@1.0.0(peer-a@1.0.0): {resolution: {integrity: sha512-same-a}}
  same@1.0.0(peer-b@1.0.0): {resolution: {integrity: sha512-same-b}}
  peer-a@1.0.0: {resolution: {integrity: sha512-peer-a}}
  peer-b@1.0.0: {resolution: {integrity: sha512-peer-b}}
snapshots:
  same@1.0.0(peer-a@1.0.0):
    dependencies: {peer-a: 1.0.0}
  same@1.0.0(peer-b@1.0.0):
    optionalDependencies: {peer-b: 1.0.0}
  peer-a@1.0.0: {}
  peer-b@1.0.0: {}
`,
      );
      const packageRoots = await Promise.all(
        [
          "same@1.0.0_peer-a@1.0.0/node_modules/same",
          "same@1.0.0_peer-b@1.0.0/node_modules/same",
          "peer-a@1.0.0/node_modules/peer-a",
          "peer-b@1.0.0/node_modules/peer-b",
        ].map(async (relative) => {
          const packageRoot = path.join(
            root,
            "node_modules",
            ".pnpm",
            relative,
          );
          await mkdir(packageRoot, { recursive: true });
          return packageRoot;
        }),
      );
      await expect(
        resolveLockInstances(
          root,
          packageRoots.map((packageRoot) => ({
            id: "unreconciled",
            name: path.basename(packageRoot),
            version: "1.0.0",
            integrity: "bundled-local-resolution",
            dependencies: [],
            packageRoot,
          })),
        ),
      ).resolves.toEqual([
        expect.objectContaining({
          id: "same@1.0.0(peer-a@1.0.0)",
          dependencies: [expect.objectContaining({ kind: "dependencies" })],
        }),
        expect.objectContaining({
          id: "same@1.0.0(peer-b@1.0.0)",
          dependencies: [
            expect.objectContaining({ kind: "optionalDependencies" }),
          ],
        }),
        expect.objectContaining({ id: "peer-a@1.0.0" }),
        expect.objectContaining({ id: "peer-b@1.0.0" }),
      ]);
    } finally {
      await cleanupTempDir(root);
    }
  });

  it("reconciles nested peer identities with pnpm's trailing underscore encoding", async () => {
    const root = await createTempDir();
    try {
      await writeFile(
        path.join(root, "pnpm-lock.yaml"),
        `
importers:
  .:
    dependencies:
      same-b: {version: same@1.0.0(peer-a@1.0.0)(peer-b@1.0.0)}
      same-c: {version: same@1.0.0(peer-a@1.0.0)(peer-c@1.0.0)}
packages:
  same@1.0.0(peer-a@1.0.0)(peer-b@1.0.0): {resolution: {integrity: sha512-same-b}}
  same@1.0.0(peer-a@1.0.0)(peer-c@1.0.0): {resolution: {integrity: sha512-same-c}}
snapshots:
  same@1.0.0(peer-a@1.0.0)(peer-b@1.0.0): {}
  same@1.0.0(peer-a@1.0.0)(peer-c@1.0.0): {}
`,
      );
      const packageRoots = await Promise.all(
        [
          "same@1.0.0_peer-a@1.0.0_peer-b@1.0.0_/node_modules/same",
          "same@1.0.0_peer-a@1.0.0_peer-c@1.0.0_/node_modules/same",
        ].map(async (relative) => {
          const packageRoot = path.join(
            root,
            "node_modules",
            ".pnpm",
            relative,
          );
          await mkdir(packageRoot, { recursive: true });
          return packageRoot;
        }),
      );

      await expect(
        resolveLockInstances(
          root,
          packageRoots.map((packageRoot) => ({
            id: "unreconciled",
            name: "same",
            version: "1.0.0",
            integrity: "bundled-local-resolution",
            dependencies: [],
            packageRoot,
          })),
        ),
      ).resolves.toEqual([
        expect.objectContaining({
          id: "same@1.0.0(peer-a@1.0.0)(peer-b@1.0.0)",
        }),
        expect.objectContaining({
          id: "same@1.0.0(peer-a@1.0.0)(peer-c@1.0.0)",
        }),
      ]);
    } finally {
      await cleanupTempDir(root);
    }
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
