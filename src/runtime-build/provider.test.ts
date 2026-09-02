import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempDir, createTempDir } from "../__test-helpers__/fixtures.js";
import { PROVIDER_LEAVES, sha256, verifyProvider } from "./provider.js";

const VERSION = "2.0.0";
const INPUT_SHA = "a".repeat(64);
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(cleanupTempDir));
});

describe("verifyProvider", () => {
  it("accepts an exact source-build root and returns frozen bytes", async () => {
    const root = await createProvider("source-build");

    const accepted = await verifyProvider({
      root,
      origin: "source-build",
      devcanonVersion: VERSION,
      inputSha256: INPUT_SHA,
    });

    expect(Object.isFrozen(accepted)).toBe(true);
    expect(Object.isFrozen(accepted.manifest)).toBe(true);
    expect(accepted.bundle.toString()).toBe("export {};\n");
    expect(accepted.licenses.toString()).toBe("example license\n");
  });

  it("rejects an unexpected physical leaf before parsing the manifest", async () => {
    const root = await createProvider("package");
    await writeFile(path.join(root, "unexpected"), "not allowed");

    await expect(
      verifyProvider({ root, origin: "package", devcanonVersion: VERSION }),
    ).rejects.toThrow(/exactly the required files/i);
  });

  it("rejects a linked leaf", async () => {
    const root = await createProvider("package");
    const bundle = path.join(root, "devcanon-runtime.mjs");
    const external = await createTempDir();
    tempDirs.push(external);
    const target = path.join(external, "bundle-target.mjs");
    await writeFile(target, "export {};\n");
    await rm(bundle);
    await symlink(target, bundle);

    await expect(
      verifyProvider({ root, origin: "package", devcanonVersion: VERSION }),
    ).rejects.toThrow(/regular non-link/i);
  });

  it("recomputes source input identity but treats package input identity as attested", async () => {
    const sourceRoot = await createProvider("source-build");
    await expect(
      verifyProvider({
        root: sourceRoot,
        origin: "source-build",
        devcanonVersion: VERSION,
        inputSha256: "b".repeat(64),
      }),
    ).rejects.toThrow(/input digest/i);

    const packageRoot = await createProvider("package");
    await expect(
      verifyProvider({
        root: packageRoot,
        origin: "package",
        devcanonVersion: VERSION,
      }),
    ).resolves.toMatchObject({ origin: "package" });
  });

  it("rejects an explicit origin mismatch", async () => {
    const root = await createProvider("package");
    await expect(
      verifyProvider({
        root,
        origin: "source-build",
        devcanonVersion: VERSION,
        inputSha256: INPUT_SHA,
      }),
    ).rejects.toThrow(/origin/i);
  });

  it("does not expose mutable captured provider bytes", async () => {
    const root = await createProvider("package");
    const accepted = await verifyProvider({
      root,
      origin: "package",
      devcanonVersion: VERSION,
    });
    const copy = accepted.bundle.copy();
    copy[0] = 0;

    expect(accepted.bundle.toString()).toBe("export {};\n");
  });

  it("rejects changed bundle bytes with a retained digest", async () => {
    const root = await createProvider("package");
    await writeFile(
      path.join(root, "devcanon-runtime.mjs"),
      "export const bad = 1;\n",
    );

    await expect(
      verifyProvider({ root, origin: "package", devcanonVersion: VERSION }),
    ).rejects.toThrow(/bundle digest/i);
  });
});

async function createProvider(
  origin: "source-build" | "package",
): Promise<string> {
  const root = await createTempDir();
  tempDirs.push(root);
  await mkdir(root, { recursive: true });
  const bundle = Buffer.from("export {};\n");
  const licenses = Buffer.from("example license\n");
  const manifest = {
    schema: "devcanon-runtime-build/v1",
    devcanon_version: VERSION,
    artifact_origin: origin,
    input_sha256: INPUT_SHA,
    bundle_sha256: sha256(bundle),
    licenses_sha256: sha256(licenses),
    node_target: "node24",
  };
  await writeFile(path.join(root, PROVIDER_LEAVES.bundle), bundle);
  await writeFile(path.join(root, PROVIDER_LEAVES.licenses), licenses);
  await writeFile(
    path.join(root, PROVIDER_LEAVES.manifest),
    `${JSON.stringify(manifest)}\n`,
  );
  return root;
}
