import {
  chmod,
  lstat,
  mkdir,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  canCreateSymlinks,
  canMutateExecutableMode,
  cleanupTempDir,
  createTempDir,
} from "../__test-helpers__/fixtures.js";
import {
  normalizePackagedShellBytes,
  normalizePackagedShellTree,
} from "./packaged-shell.js";

const symlinkAvailable = await canCreateSymlinks();
const executableModeMutable = await canMutateExecutableMode();

describe("normalizePackagedShellBytes", () => {
  it("normalizes CRLF pairs only for packaged scripts shell files", () => {
    const crlfShell = Buffer.from(
      "#!/usr/bin/env bash\r\nset -eu\r\n",
      "utf-8",
    );

    expect(
      normalizePackagedShellBytes("scripts/nested/tool.sh", crlfShell),
    ).toStrictEqual(Buffer.from("#!/usr/bin/env bash\nset -eu\n", "utf-8"));
    expect(
      normalizePackagedShellBytes("scripts/data.txt", crlfShell),
    ).toStrictEqual(crlfShell);
    expect(
      normalizePackagedShellBytes("references/tool.sh", crlfShell),
    ).toStrictEqual(crlfShell);
  });

  it("leaves LF and lone CR bytes unchanged", () => {
    const bytes = Buffer.from("first\nsecond\rthird\n", "utf-8");

    expect(normalizePackagedShellBytes("scripts/tool.sh", bytes)).toStrictEqual(
      bytes,
    );
  });

  it.skipIf(!symlinkAvailable)(
    "normalizes regular files without following symlinks or changing executable mode",
    async () => {
      const tempDir = await createTempDir();
      try {
        const scriptsDir = path.join(tempDir, "scripts");
        const shellPath = path.join(scriptsDir, "tool.sh");
        const externalPath = path.join(tempDir, "external.sh");
        await mkdir(scriptsDir, { recursive: true });
        await writeFile(shellPath, "#!/usr/bin/env bash\r\necho shell\r\n");
        await chmod(shellPath, 0o755);
        const shellMode = (await lstat(shellPath)).mode & 0o777;
        await writeFile(
          externalPath,
          "#!/usr/bin/env bash\r\necho external\r\n",
        );
        await symlink(externalPath, path.join(scriptsDir, "linked.sh"), "file");

        await normalizePackagedShellTree(scriptsDir);

        await expect(readFile(shellPath)).resolves.toStrictEqual(
          Buffer.from("#!/usr/bin/env bash\necho shell\n"),
        );
        if (executableModeMutable) {
          expect((await lstat(shellPath)).mode & 0o777).toBe(shellMode);
        }
        expect(
          (await lstat(path.join(scriptsDir, "linked.sh"))).isSymbolicLink(),
        ).toBe(true);
        await expect(readFile(externalPath)).resolves.toStrictEqual(
          Buffer.from("#!/usr/bin/env bash\r\necho external\r\n"),
        );
      } finally {
        await cleanupTempDir(tempDir);
      }
    },
  );
});
