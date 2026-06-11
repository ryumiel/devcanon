import { execFile } from "node:child_process";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { canCreateSymlinks } from "../__test-helpers__/fixtures.js";
import {
  createRuntimeConformanceFixture,
  expectFileBytesEqual,
  renderRuntimeConformanceFixture,
  runRuntimeBackedAdapter,
  syncRuntimeConformanceFixture,
  toBashPath,
} from "../__test-helpers__/runtime-conformance.js";

const execFileAsync = promisify(execFile);
const symlinkAvailable = await canCreateSymlinks();

function expectContractOutput(stdout: string): void {
  expect(JSON.parse(stdout)).toEqual({
    command_group: "devcanon-runtime",
    major_version: 1,
    helper_foundation: true,
  });
}

describe("devcanon-runtime conformance harness", () => {
  it("runs a runtime-backed adapter from source, generated, and copy-installed layouts", async () => {
    const fixture = await createRuntimeConformanceFixture();
    try {
      const sourceResult = await runRuntimeBackedAdapter(
        fixture.sourceAdapterPath,
        ["contract"],
      );
      expect(sourceResult).toMatchObject({ code: 0, stderr: "" });
      expectContractOutput(sourceResult.stdout);

      await renderRuntimeConformanceFixture(fixture);
      const generatedAdapterPath = fixture.generatedAdapterPath("codex");
      await expectFileBytesEqual(
        generatedAdapterPath,
        fixture.sourceAdapterPath,
      );
      const generatedResult = await runRuntimeBackedAdapter(
        generatedAdapterPath,
        ["contract"],
      );
      expect(generatedResult).toMatchObject({ code: 0, stderr: "" });
      expectContractOutput(generatedResult.stdout);

      const syncResult = await syncRuntimeConformanceFixture(fixture, "copy");
      expect(syncResult.errors).toEqual([]);
      const installedAdapterPath = fixture.installedAdapterPath("codex");
      await expectFileBytesEqual(
        installedAdapterPath,
        fixture.sourceAdapterPath,
      );
      const installedResult = await runRuntimeBackedAdapter(
        installedAdapterPath,
        ["contract"],
      );
      expect(installedResult).toMatchObject({ code: 0, stderr: "" });
      expectContractOutput(installedResult.stdout);
    } finally {
      await fixture.cleanup();
    }
  });

  it.skipIf(!symlinkAvailable)(
    "runs a runtime-backed adapter from a symlink-installed layout",
    async () => {
      const fixture = await createRuntimeConformanceFixture();
      try {
        const syncResult = await syncRuntimeConformanceFixture(
          fixture,
          "symlink",
        );
        expect(syncResult.errors).toEqual([]);

        const installedConsumerDir = path.dirname(
          path.dirname(fixture.installedAdapterPath("codex")),
        );
        expect((await lstat(installedConsumerDir)).isSymbolicLink()).toBe(true);

        const installedAdapterPath = fixture.installedAdapterPath("codex");
        const installedResult = await runRuntimeBackedAdapter(
          installedAdapterPath,
          ["contract"],
        );
        expect(installedResult).toMatchObject({ code: 0, stderr: "" });
        expectContractOutput(installedResult.stdout);
      } finally {
        await fixture.cleanup();
      }
    },
  );

  it("normalizes Windows paths through a runtime-backed adapter", async () => {
    const fixture = await createRuntimeConformanceFixture();
    try {
      const result = await runRuntimeBackedAdapter(
        fixture.sourceAdapterPath,
        [
          "path-info",
          "--path",
          "C:\\Temp\\..\\Agent\\File.TXT",
          "--platform",
          "win32",
        ],
        { MSYS2_ARG_CONV_EXCL: "*" },
      );

      expect(result).toMatchObject({ code: 0, stderr: "" });
      expect(JSON.parse(result.stdout)).toMatchObject({
        normalized: "C:\\Agent\\File.TXT",
        comparable: "c:/agent/file.txt",
        isAbsolute: true,
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("fails before runtime-backed adapter execution when the sibling runtime is missing", async () => {
    const fixture = await createRuntimeConformanceFixture({
      includeRuntime: false,
    });
    try {
      await expect(
        execFileAsync("bash", [
          await toBashPath(
            path.resolve("skills/devcanon-runtime/scripts/devcanon-runtime.sh"),
          ),
          "resolve-entrypoint",
          "--from",
          await toBashPath(fixture.sourceAdapterPath),
          "--entrypoint",
          "scripts/devcanon-runtime.sh",
        ]),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "Ensure generated previews or installed skill homes include the sibling devcanon-runtime support skill",
        ),
      });
    } finally {
      await fixture.cleanup();
    }
  });
});
