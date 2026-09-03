import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canCreateSymlinks,
  canMutateExecutableMode,
  cleanupTempDir,
  copyDevcanonRuntimeFixture,
  createDevcanonRuntimeProviderFixture,
  createTempDir,
  makeResolvedConfig,
} from "../__test-helpers__/fixtures.js";
import { renderAll } from "../render/pipeline.js";
import type { UserError } from "../utils/errors.js";
import {
  classifyAdapterPair,
  validateBundledDevcanonRuntime,
  validateDevcanonRuntime,
} from "./devcanon-runtime.js";

const symlinkAvailable = await canCreateSymlinks();
const executableModeMutable = await canMutateExecutableMode();

describe("devcanon-runtime source validation", () => {
  let tempDir: string;
  let config: ReturnType<typeof makeResolvedConfig>;

  beforeEach(async () => {
    tempDir = await createTempDir();
    config = makeResolvedConfig(tempDir);
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await copyDevcanonRuntimeFixture(config.library.skillsDir);
  });

  afterEach(async () => cleanupTempDir(tempDir));

  it("accepts the closed three-leaf derived runtime subtree", async () => {
    const runtimeDir = path.join(config.library.skillsDir, "devcanon-runtime");
    await expect(
      readdir(path.join(runtimeDir, "scripts", "runtime")),
    ).resolves.toEqual([
      "THIRD_PARTY_LICENSES",
      "devcanon-runtime.mjs",
      "runtime-manifest.json",
    ]);
    await expect(validateDevcanonRuntime(runtimeDir)).resolves.toMatchObject({
      runtimeDir,
    });
  });

  it("keeps current, legacy, mixed, and modified adapter states distinct", () => {
    const current = {
      shell: Buffer.from("current"),
      resolver: Buffer.from("resolver"),
      shellMode: 0o755,
      resolverMode: 0o644,
    };
    const legacy = {
      shell: Buffer.from("legacy"),
      resolver: Buffer.from("legacy-resolver"),
      shellMode: 0o755,
      resolverMode: 0o644,
    };
    expect(classifyAdapterPair(current, current, legacy)).toBe("current");
    expect(classifyAdapterPair(legacy, current, legacy)).toBe(
      "pristine-legacy",
    );
    expect(
      classifyAdapterPair(
        {
          shell: legacy.shell,
          resolver: current.resolver,
          shellMode: 0o755,
          resolverMode: 0o644,
        },
        current,
        legacy,
      ),
    ).toBe("mixed");
    expect(
      classifyAdapterPair(
        {
          shell: Buffer.from("changed"),
          resolver: Buffer.from("changed-resolver"),
          shellMode: 0o755,
          resolverMode: 0o644,
        },
        current,
        legacy,
      ),
    ).toBe("modified");
  });

  it("ignores non-semantic adapter mode differences", () => {
    const current = {
      shell: Buffer.from("current"),
      resolver: Buffer.from("resolver"),
      shellMode: 0o755,
      resolverMode: 0o644,
    };

    expect(
      classifyAdapterPair(
        { ...current, shellMode: 0o700, resolverMode: 0o600 },
        current,
      ),
    ).toBe("current");
  });

  it("does not treat a mixed candidate as its own adapter authority", async () => {
    const runtimeDir = path.join(config.library.skillsDir, "devcanon-runtime");
    await writeFile(
      path.join(runtimeDir, "scripts", "devcanon-runtime.sh"),
      "#!/usr/bin/env bash\nexit 0\n",
    );
    await expect(validateDevcanonRuntime(runtimeDir)).rejects.toMatchObject({
      message: "Passive runtime adapter pair is mixed.",
      hint: expect.stringContaining("Back up both adapters"),
    } satisfies Partial<UserError>);
  });

  it("reports a fully modified candidate without collapsing its state", async () => {
    const runtimeDir = path.join(config.library.skillsDir, "devcanon-runtime");
    await writeFile(
      path.join(runtimeDir, "scripts", "devcanon-runtime.sh"),
      "#!/usr/bin/env bash\nexit 0\n",
    );
    await writeFile(
      path.join(runtimeDir, "scripts", "resolve-bash.mjs"),
      "throw new Error('modified');\n",
    );
    await expect(validateDevcanonRuntime(runtimeDir)).rejects.toMatchObject({
      message: "Passive runtime adapter pair is modified.",
      hint: expect.stringContaining("Back up both adapters"),
    } satisfies Partial<UserError>);
  });

  it("directs a pristine legacy pair to render in read-only validation", async () => {
    const runtimeDir = path.join(config.library.skillsDir, "devcanon-runtime");
    const legacy = {
      shell: await readFile(
        path.join(runtimeDir, "scripts", "devcanon-runtime.sh"),
      ),
      resolver: await readFile(
        path.join(runtimeDir, "scripts", "resolve-bash.mjs"),
      ),
      shellMode: 0o755,
      resolverMode: 0o644,
    };
    const authority = path.join(tempDir, "authority");
    await mkdir(path.join(authority, "scripts"), { recursive: true });
    await writeFile(
      path.join(authority, "scripts", "devcanon-runtime.sh"),
      "#!/usr/bin/env bash\necho current\n",
    );
    await chmod(path.join(authority, "scripts", "devcanon-runtime.sh"), 0o755);
    await writeFile(
      path.join(authority, "scripts", "resolve-bash.mjs"),
      "export {};\n",
    );

    await expect(
      validateDevcanonRuntime(runtimeDir, {
        adapterSourceDir: authority,
        pristineLegacyPair: legacy,
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("recognized pristine legacy pair"),
      hint: expect.stringContaining("devcanon render"),
    } satisfies Partial<UserError>);
  });

  it("uses authoritative current bytes for a pristine legacy compose snapshot", async () => {
    const runtimeDir = path.join(config.library.skillsDir, "devcanon-runtime");
    const legacy = {
      shell: await readFile(
        path.join(runtimeDir, "scripts", "devcanon-runtime.sh"),
      ),
      resolver: await readFile(
        path.join(runtimeDir, "scripts", "resolve-bash.mjs"),
      ),
      shellMode: 0o755,
      resolverMode: 0o644,
    };
    const authority = path.join(tempDir, "authority");
    await mkdir(path.join(authority, "scripts"), { recursive: true });
    const currentShell = Buffer.from("#!/usr/bin/env bash\necho current\n");
    const currentResolver = Buffer.from("console.log('/bin/bash');\n");
    await writeFile(
      path.join(authority, "scripts", "devcanon-runtime.sh"),
      currentShell,
    );
    await chmod(path.join(authority, "scripts", "devcanon-runtime.sh"), 0o755);
    await writeFile(
      path.join(authority, "scripts", "resolve-bash.mjs"),
      currentResolver,
    );

    await expect(
      validateDevcanonRuntime(runtimeDir, {
        adapterSourceDir: authority,
        pristineLegacyPair: legacy,
        operation: "compose",
      }),
    ).resolves.toMatchObject({
      adapterState: "pristine-legacy",
      adapterPair: { shell: currentShell, resolver: currentResolver },
    });
  });

  it("recognizes the closed production legacy adapter pair without caller input", async () => {
    const runtimeDir = path.join(config.library.skillsDir, "devcanon-runtime");
    const shellPath = path.join(runtimeDir, "scripts", "devcanon-runtime.sh");
    const resolverPath = path.join(runtimeDir, "scripts", "resolve-bash.mjs");
    const currentShell = await readFile(shellPath, "utf8");
    const currentResolver = await readFile(resolverPath, "utf8");
    await writeFile(shellPath, legacyShellAdapter(currentShell));
    await writeFile(resolverPath, legacyResolverAdapter(currentResolver));

    await expect(
      validateDevcanonRuntime(runtimeDir, { operation: "compose" }),
    ).resolves.toMatchObject({
      adapterState: "pristine-legacy",
      sourceDisposition: "migrate-adapters-and-runtime",
    });
  });

  it("reports each invalid adapter state with manual-adoption guidance", async () => {
    const runtimeDir = path.join(config.library.skillsDir, "devcanon-runtime");
    const scripts = path.join(runtimeDir, "scripts");
    await rm(path.join(scripts, "devcanon-runtime.sh"));
    await expect(validateDevcanonRuntime(runtimeDir)).rejects.toMatchObject({
      message: expect.stringContaining("is missing"),
      hint: expect.stringContaining("Back up both adapters"),
    } satisfies Partial<UserError>);
  });

  it("reports a missing derived subtree with render guidance without mutation", async () => {
    const runtimeDir = path.join(config.library.skillsDir, "devcanon-runtime");
    const runtimePath = path.join(runtimeDir, "scripts", "runtime");
    await rm(runtimePath, { recursive: true });
    await expect(validateDevcanonRuntime(runtimeDir)).rejects.toMatchObject({
      message: expect.stringContaining("derived subtree is missing or stale"),
      hint: expect.stringContaining("devcanon render"),
    } satisfies Partial<UserError>);
    await expect(
      readdir(path.join(runtimeDir, "scripts")),
    ).resolves.not.toContain("runtime");
  });

  it("reports an extra derived leaf with render guidance before generated output is touched", async () => {
    const runtimeDir = path.join(config.library.skillsDir, "devcanon-runtime");
    await writeFile(
      path.join(runtimeDir, "scripts", "runtime", "extra.js"),
      "extra\n",
    );
    await expect(renderAll(config, true)).rejects.toMatchObject({
      message: expect.stringContaining("derived subtree is missing or stale"),
      hint: expect.stringContaining("devcanon render"),
    } satisfies Partial<UserError>);
  });

  it.each([
    ["config", "extra.json"],
    ["scripts", "extra.mjs"],
  ])("rejects an unexpected %s entry", async (directory, leaf) => {
    const runtimeDir = path.join(config.library.skillsDir, "devcanon-runtime");
    await writeFile(path.join(runtimeDir, directory, leaf), "extra\n");

    await expect(validateDevcanonRuntime(runtimeDir)).rejects.toMatchObject({
      message: expect.stringContaining("derived subtree is missing or stale"),
    } satisfies Partial<UserError>);
  });

  it.skipIf(!symlinkAvailable)(
    "rejects a linked adapter pair with manual-adoption guidance",
    async () => {
      const runtimeDir = path.join(
        config.library.skillsDir,
        "devcanon-runtime",
      );
      const resolver = path.join(runtimeDir, "scripts", "resolve-bash.mjs");
      const outside = path.join(tempDir, "resolver.mjs");
      await writeFile(outside, "export {};\n");
      await rm(resolver);
      await symlink(outside, resolver);
      await expect(validateDevcanonRuntime(runtimeDir)).rejects.toMatchObject({
        message: expect.stringContaining("is linked"),
        hint: expect.stringContaining("Back up both adapters"),
      } satisfies Partial<UserError>);
    },
  );

  it.skipIf(!executableModeMutable)(
    "rejects a non-executable shell adapter with manual-adoption guidance",
    async () => {
      const runtimeDir = path.join(
        config.library.skillsDir,
        "devcanon-runtime",
      );
      await chmod(
        path.join(runtimeDir, "scripts", "devcanon-runtime.sh"),
        0o644,
      );
      await expect(validateDevcanonRuntime(runtimeDir)).rejects.toMatchObject({
        message: expect.stringContaining("is posix-mode-invalid"),
        hint: expect.stringContaining("Back up both adapters"),
      } satisfies Partial<UserError>);
    },
  );

  it("rejects a broken authoritative shell even when authority equals candidate", async () => {
    const authority = path.join(tempDir, "authority");
    await copyDevcanonRuntimeFixture(path.join(tempDir, "authority-parent"));
    const copied = path.join(tempDir, "authority-parent", "devcanon-runtime");
    await mkdir(path.dirname(authority), { recursive: true });
    // Rename gives a bounded local authority seam without touching checkout bytes.
    const { rename } = await import("node:fs/promises");
    await rename(copied, authority);
    await writeFile(
      path.join(authority, "scripts", "devcanon-runtime.sh"),
      "#!/usr/bin/env bash\necho not-contract\n",
    );
    await chmod(path.join(authority, "scripts", "devcanon-runtime.sh"), 0o755);
    await expect(
      validateBundledDevcanonRuntime(authority, {
        adapterSourceDir: authority,
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("adapter contract check failed"),
    } satisfies Partial<UserError>);
  });

  it("rejects a broken authoritative resolver even when authority equals candidate", async () => {
    const authority = path.join(tempDir, "authority");
    await copyDevcanonRuntimeFixture(path.join(tempDir, "authority-parent"));
    const copied = path.join(tempDir, "authority-parent", "devcanon-runtime");
    const { rename } = await import("node:fs/promises");
    await rename(copied, authority);
    await writeFile(
      path.join(authority, "scripts", "resolve-bash.mjs"),
      "throw new Error('broken');\n",
    );
    await expect(
      validateBundledDevcanonRuntime(authority, {
        adapterSourceDir: authority,
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("adapter contract check failed"),
    } satisfies Partial<UserError>);
  });

  it("validates authoritative adapters against a supplied provider", async () => {
    const authority = path.join(tempDir, "authority");
    await copyDevcanonRuntimeFixture(path.join(tempDir, "authority-parent"));
    const copied = path.join(tempDir, "authority-parent", "devcanon-runtime");
    const { rename } = await import("node:fs/promises");
    await rename(copied, authority);
    const provider = await createDevcanonRuntimeProviderFixture(tempDir);
    await writeFile(
      path.join(authority, "scripts", "resolve-bash.mjs"),
      "throw new Error('broken');\n",
    );

    await expect(
      validateBundledDevcanonRuntime(authority, {
        adapterSourceDir: authority,
        provider,
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("adapter contract check failed"),
    } satisfies Partial<UserError>);
  });

  it("rejects an authoritative shell that targets a removed entrypoint", async () => {
    const authority = path.join(tempDir, "authority");
    await copyDevcanonRuntimeFixture(path.join(tempDir, "authority-parent"));
    const { rename } = await import("node:fs/promises");
    await rename(
      path.join(tempDir, "authority-parent", "devcanon-runtime"),
      authority,
    );
    await writeFile(
      path.join(authority, "scripts", "devcanon-runtime.sh"),
      [
        "#!/usr/bin/env bash",
        'if [ "$1" = contract ]; then printf \'%s\\n\' \'{"command_group":"devcanon-runtime","major_version":1}\'; exit 0; fi',
        'exec node "$(dirname "$0")/runtime/cli.js" "$@"',
        "",
      ].join("\n"),
    );
    await chmod(path.join(authority, "scripts", "devcanon-runtime.sh"), 0o755);

    await expect(
      validateBundledDevcanonRuntime(authority, {
        adapterSourceDir: authority,
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("adapter contract check failed"),
    } satisfies Partial<UserError>);
  });

  it("rejects an authoritative resolver that prints a nonexistent absolute path", async () => {
    const authority = path.join(tempDir, "authority");
    await copyDevcanonRuntimeFixture(path.join(tempDir, "authority-parent"));
    const { rename } = await import("node:fs/promises");
    await rename(
      path.join(tempDir, "authority-parent", "devcanon-runtime"),
      authority,
    );
    await writeFile(
      path.join(authority, "scripts", "resolve-bash.mjs"),
      "console.log('/definitely/not/a/bash');\n",
    );

    await expect(
      validateBundledDevcanonRuntime(authority, {
        adapterSourceDir: authority,
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("adapter contract check failed"),
    } satisfies Partial<UserError>);
  });

  it("rejects an authoritative resolver that prints the Node executable", async () => {
    const authority = path.join(tempDir, "authority");
    await copyDevcanonRuntimeFixture(path.join(tempDir, "authority-parent"));
    const { rename } = await import("node:fs/promises");
    await rename(
      path.join(tempDir, "authority-parent", "devcanon-runtime"),
      authority,
    );
    await writeFile(
      path.join(authority, "scripts", "resolve-bash.mjs"),
      "console.log(process.execPath);\n",
    );

    await expect(
      validateBundledDevcanonRuntime(authority, {
        adapterSourceDir: authority,
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("adapter contract check failed"),
      hint: expect.stringContaining("non-Bash executable path"),
    } satisfies Partial<UserError>);
  });

  it("accepts the real Bash path resolved by the current adapters", async () => {
    const runtimeDir = path.join(config.library.skillsDir, "devcanon-runtime");
    await expect(
      validateBundledDevcanonRuntime(runtimeDir),
    ).resolves.toBeUndefined();
  });
});

function legacyShellAdapter(current: string): string {
  return current
    .replace(
      [
        '  local js_entrypoint="$script_dir/runtime/devcanon-runtime.mjs"',
        '  [ -f "$js_entrypoint" ] || runtime_error "devcanon-runtime bundle missing: $js_entrypoint"',
        '  command -v node >/dev/null 2>&1 || runtime_error "node is required for devcanon-runtime typed helpers"',
        "  unset DEBUG NODE_OPTIONS",
        '  exec node "$js_entrypoint" runtime "$@"',
      ].join("\n"),
      [
        '  local js_entrypoint="$script_dir/runtime/cli.js"',
        '  [ -f "$js_entrypoint" ] || runtime_error "devcanon-runtime JS entrypoint missing: $js_entrypoint"',
        '  command -v node >/dev/null 2>&1 || runtime_error "node is required for devcanon-runtime typed helpers"',
        "  unset DEBUG NODE_OPTIONS",
        '  exec node "$js_entrypoint" "$@"',
      ].join("\n"),
    )
    .replace(
      [
        '  local js_entrypoint="$script_dir/runtime/devcanon-runtime.mjs"',
        '  [ -f "$js_entrypoint" ] || runtime_error "devcanon-runtime bundle missing: $js_entrypoint"',
        '  command -v node >/dev/null 2>&1 || runtime_error "node is required for devcanon-runtime bootstrap"',
        '  exec node "$js_entrypoint" bootstrap "$@"',
      ].join("\n"),
      [
        '  local js_entrypoint="$script_dir/runtime/bootstrap-cli.js"',
        '  [ -f "$js_entrypoint" ] || runtime_error "devcanon-runtime bootstrap entrypoint missing: $js_entrypoint"',
        '  command -v node >/dev/null 2>&1 || runtime_error "node is required for devcanon-runtime bootstrap"',
        '  exec node "$js_entrypoint" "$@"',
      ].join("\n"),
    );
}

function legacyResolverAdapter(current: string): string {
  return current
    .replace(
      'const cliPath = path.join(scriptDir, "runtime", "devcanon-runtime.mjs");',
      'const cliPath = path.join(scriptDir, "runtime", "cli.js");',
    )
    .replaceAll(
      "devcanon-runtime bundle missing",
      "devcanon-runtime JS entrypoint missing",
    )
    .replace(
      [
        "const child = spawnSync(",
        "  process.execPath,",
        '  [cliPath, "runtime", "resolve-bash"],',
        "  {",
        '    encoding: "utf8",',
        "    env: process.env,",
        '    input: "",',
        "    windowsHide: true,",
        "  },",
        ");",
      ].join("\n"),
      [
        'const child = spawnSync(process.execPath, [cliPath, "resolve-bash"], {',
        '  encoding: "utf8",',
        "  env: process.env,",
        '  input: "",',
        "  windowsHide: true,",
        "});",
      ].join("\n"),
    );
}
