import { execFile } from "node:child_process";
import {
  cp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { cleanupTempDir, createTempDir } from "../__test-helpers__/fixtures.js";

const execFileAsync = promisify(execFile);
const runtimeScript = path.resolve(
  "skills/devcanon-runtime/scripts/devcanon-runtime.sh",
);
const validProfiles = {
  efficient: { claude: "a", codex: "b" },
  balanced: { claude: "c", codex: "d" },
  frontier: { claude: "e", codex: "f" },
};

const planningProjectionPlan = [
  "## Execution Projection",
  "",
  "- **Entry ID:** `EP-RUNTIME-RESULT-PRODUCTION`",
  '  - **Affected surface or equivalent set:** ["runtime inspector"]',
  "  - **Owner/source:** `issue #651` — result contract",
  "  - **Mode:** `authority`",
  "  - **Implementation disposition:** Tasks [`BUILD-PROJECTION-OPERATION`]",
  "  - **Proof:** Task `BUILD-PROJECTION-OPERATION` — focused proof",
  "",
  "## Tasks",
  "",
  "### Task 1: Build projection operation",
  "",
  "**Task ID:** BUILD-PROJECTION-OPERATION",
  "",
].join("\n");

const pollutedRuntimeEnvironments = [
  { NODE_OPTIONS: "--conditions=browser", DEBUG: "*" },
  { NODE_OPTIONS: "--conditions=development", DEBUG: "*" },
] as const;

describe("devcanon-runtime typed entrypoint", () => {
  it("tracks the compiled JavaScript entrypoint as executable", async () => {
    const { stdout } = await execFileAsync("git", [
      "ls-files",
      "-s",
      "skills/devcanon-runtime/scripts/runtime/cli.js",
    ]);

    expect(stdout).toMatch(/^100755 /u);
  });

  it("runs the packaged compiled JavaScript contract command through the shell adapter", async () => {
    const { stdout, stderr } = await execFileAsync("bash", [
      runtimeScript,
      "runtime",
      "contract",
    ]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      command_group: "devcanon-runtime",
      major_version: 1,
      helper_foundation: true,
    });
  });

  it("emits stable stderr JSON for path guard failures", async () => {
    await expect(
      execFileAsync("bash", [
        runtimeScript,
        "runtime",
        "ephemeral-child",
        "--path",
        ".ephemeral/nested/result.json",
      ]),
    ).rejects.toMatchObject({
      stderr:
        '{"ok":false,"code":"nested-path","message":"path must be a direct child under .ephemeral"}\n',
    });
  });

  it("runs from a copied passive runtime bundle without the repository package.json", async () => {
    const tempDir = await createTempDir();
    try {
      await cp(
        path.resolve("skills/devcanon-runtime"),
        path.join(tempDir, "devcanon-runtime"),
        { recursive: true },
      );
      const { stdout } = await execFileAsync(
        "bash",
        [
          path.join(
            tempDir,
            "devcanon-runtime",
            "scripts",
            "devcanon-runtime.sh",
          ),
          "runtime",
          "path-info",
          "--path",
          "/tmp/../var/result.json",
          "--platform",
          "posix",
        ],
        {
          env: { ...process.env, MSYS2_ARG_CONV_EXCL: "/tmp" },
        },
      );

      expect(JSON.parse(stdout)).toMatchObject({
        normalized: "/var/result.json",
        comparable: "/var/result.json",
      });
    } finally {
      await cleanupTempDir(tempDir);
    }
  });

  it("runs planning projection from an isolated copied passive runtime bundle", async () => {
    const tempDir = await createTempDir();
    try {
      const runtimeDir = path.join(tempDir, "devcanon-runtime");
      const planPath = path.join(tempDir, "plan.md");
      await cp(path.resolve("skills/devcanon-runtime"), runtimeDir, {
        recursive: true,
      });
      await writeFile(planPath, planningProjectionPlan, "utf-8");
      const nodeBin = path.join(tempDir, "node-bin");
      await mkdir(nodeBin);
      await symlink(process.execPath, path.join(nodeBin, "node"));
      const isolatedEnv = {
        PATH: `${nodeBin}:/usr/bin:/bin`,
        NODE_PATH: "",
      };

      const script = path.join(runtimeDir, "scripts", "devcanon-runtime.sh");
      const valid = await execFileAsync(
        "bash",
        [
          script,
          "runtime",
          "planning-projection",
          "inspect",
          "--path",
          "plan.md",
        ],
        { cwd: tempDir, env: isolatedEnv },
      );
      expect(JSON.parse(valid.stdout)).toMatchObject({
        schema: "planning-projection/v1",
        plan_path: "plan.md",
      });
      expect(valid.stderr).toBe("");

      await writeFile(
        planPath,
        planningProjectionPlan.replace("`authority`", "`unsupported mode`"),
        "utf-8",
      );
      await expect(
        execFileAsync(
          "bash",
          [
            script,
            "runtime",
            "planning-projection",
            "inspect",
            "--path",
            "plan.md",
          ],
          { cwd: tempDir, env: isolatedEnv },
        ),
      ).rejects.toMatchObject({
        stdout: "",
        stderr: expect.stringContaining("projection-entry-field-invalid"),
      });
    } finally {
      await cleanupTempDir(tempDir);
    }
  });

  it.each(pollutedRuntimeEnvironments)(
    "keeps contract and planning projection deterministic with %j",
    async (env) => {
      const tempDir = await createTempDir();
      try {
        const runtimeDir = path.join(tempDir, "devcanon-runtime");
        const planPath = path.join(tempDir, "plan.md");
        await cp(path.resolve("skills/devcanon-runtime"), runtimeDir, {
          recursive: true,
        });
        await writeFile(planPath, planningProjectionPlan, "utf-8");
        const script = path.join(runtimeDir, "scripts", "devcanon-runtime.sh");

        await expect(
          execFileAsync("bash", [script, "runtime", "contract"], {
            cwd: tempDir,
            env: { ...process.env, ...env },
          }),
        ).resolves.toMatchObject({
          stdout:
            '{"command_group":"devcanon-runtime","major_version":1,"helper_foundation":true}\n',
          stderr: "",
        });

        const projection = await execFileAsync(
          "bash",
          [
            script,
            "runtime",
            "planning-projection",
            "inspect",
            "--path",
            "plan.md",
          ],
          { cwd: tempDir, env: { ...process.env, ...env } },
        );
        expect(projection.stderr).toBe("");
        expect(JSON.parse(projection.stdout)).toMatchObject({
          schema: "planning-projection/v1",
          plan_path: "plan.md",
        });
      } finally {
        await cleanupTempDir(tempDir);
      }
    },
  );

  it("reads config path and values from the copied sibling catalog outside the repository", async () => {
    const tempDir = await createTempDir();
    try {
      const runtimeDir = path.join(tempDir, "devcanon-runtime");
      const unrelatedCwd = path.join(tempDir, "unrelated");
      await cp(path.resolve("skills/devcanon-runtime"), runtimeDir, {
        recursive: true,
      });
      await mkdir(unrelatedCwd);
      const script = path.join(runtimeDir, "scripts", "devcanon-runtime.sh");

      const catalogPath = await execFileAsync(
        "bash",
        [script, "runtime", "config", "path"],
        { cwd: unrelatedCwd },
      );
      const catalogValue = await execFileAsync(
        "bash",
        [
          script,
          "runtime",
          "config",
          "get",
          "--key",
          "capabilityProfiles.balanced.codex",
        ],
        { cwd: unrelatedCwd },
      );
      const typedCatalogValue = await execFileAsync(
        process.execPath,
        [
          path.join(runtimeDir, "scripts", "runtime", "cli.js"),
          "config",
          "get",
          "--key",
          "capabilityProfiles.balanced.codex",
        ],
        { cwd: unrelatedCwd },
      );

      expect(JSON.parse(catalogPath.stdout)).toEqual({
        path: await realpath(
          path.join(runtimeDir, "config", "runtime-config.json"),
        ),
      });
      expect(JSON.parse(catalogValue.stdout)).toEqual({
        key: "capabilityProfiles.balanced.codex",
        value: "gpt-5.6-terra",
      });
      expect(typedCatalogValue.stdout).toBe(catalogValue.stdout);

      await expect(
        execFileAsync(
          "bash",
          [
            script,
            "runtime",
            "config",
            "get",
            "--key",
            "capabilityProfiles.balanced.codex",
            "--key",
            "capabilityProfiles.frontier.codex",
          ],
          { cwd: unrelatedCwd },
        ),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("config get requires exactly"),
      });
    } finally {
      await cleanupTempDir(tempDir);
    }
  });

  it("fails malformed catalog arrays with a stable runtime envelope", async () => {
    const tempDir = await createTempDir();
    try {
      const runtimeDir = path.join(tempDir, "devcanon-runtime");
      await cp(path.resolve("skills/devcanon-runtime"), runtimeDir, {
        recursive: true,
      });
      await writeFile(
        path.join(runtimeDir, "config", "runtime-config.json"),
        "[",
        "utf-8",
      );

      await expect(
        execFileAsync(
          "bash",
          [
            path.join(runtimeDir, "scripts", "devcanon-runtime.sh"),
            "runtime",
            "config",
            "path",
          ],
          { timeout: 500 },
        ),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "invalid runtime configuration catalog",
        ),
      });
    } finally {
      await cleanupTempDir(tempDir);
    }
  });

  it.each([
    [
      "removes the catalog",
      async (runtimeDir: string) => {
        await rm(path.join(runtimeDir, "config", "runtime-config.json"));
      },
    ],
    [
      "duplicates a catalog key",
      async (runtimeDir: string) => {
        await writeFile(
          path.join(runtimeDir, "config", "runtime-config.json"),
          '{"schema":"devcanon/runtime-config/v1","schema":"devcanon/runtime-config/v1"}',
          "utf-8",
        );
      },
    ],
  ] as const)("fails when it %s", async (_name, mutate) => {
    const tempDir = await createTempDir();
    try {
      const runtimeDir = path.join(tempDir, "devcanon-runtime");
      await cp(path.resolve("skills/devcanon-runtime"), runtimeDir, {
        recursive: true,
      });
      await mutate(runtimeDir);

      await expect(
        execFileAsync("bash", [
          path.join(runtimeDir, "scripts", "devcanon-runtime.sh"),
          "runtime",
          "config",
          "path",
        ]),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "invalid runtime configuration catalog",
        ),
      });
    } finally {
      await cleanupTempDir(tempDir);
    }
  });

  it.each([
    [
      "an unsupported schema",
      {
        schema: "devcanon/runtime-config/v2",
        capabilityProfiles: validProfiles,
      },
    ],
    [
      "a missing profile",
      {
        schema: "devcanon/runtime-config/v1",
        capabilityProfiles: {
          efficient: validProfiles.efficient,
          balanced: validProfiles.balanced,
        },
      },
    ],
    [
      "a missing target",
      {
        schema: "devcanon/runtime-config/v1",
        capabilityProfiles: {
          ...validProfiles,
          balanced: { claude: "c" },
        },
      },
    ],
    [
      "a blank model",
      {
        schema: "devcanon/runtime-config/v1",
        capabilityProfiles: {
          ...validProfiles,
          balanced: { claude: "c", codex: " " },
        },
      },
    ],
    [
      "a nested extra field",
      {
        schema: "devcanon/runtime-config/v1",
        capabilityProfiles: {
          ...validProfiles,
          balanced: { claude: "c", codex: "d", extra: true },
        },
      },
    ],
  ])("fails a catalog with %s", async (_name, catalog) => {
    const tempDir = await createTempDir();
    try {
      const runtimeDir = path.join(tempDir, "devcanon-runtime");
      await cp(path.resolve("skills/devcanon-runtime"), runtimeDir, {
        recursive: true,
      });
      await writeFile(
        path.join(runtimeDir, "config", "runtime-config.json"),
        JSON.stringify(catalog),
        "utf-8",
      );

      await expect(
        execFileAsync("bash", [
          path.join(runtimeDir, "scripts", "devcanon-runtime.sh"),
          "runtime",
          "config",
          "path",
        ]),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "invalid runtime configuration catalog",
        ),
      });
    } finally {
      await cleanupTempDir(tempDir);
    }
  });

  it.skipIf(process.platform === "win32")(
    "rejects a catalog reached through a symlinked config directory",
    async () => {
      const tempDir = await createTempDir();
      try {
        const runtimeDir = path.join(tempDir, "devcanon-runtime");
        const externalConfig = path.join(tempDir, "external-config");
        await cp(path.resolve("skills/devcanon-runtime"), runtimeDir, {
          recursive: true,
        });
        await mkdir(externalConfig);
        await writeFile(
          path.join(externalConfig, "runtime-config.json"),
          await readFile(
            path.join(runtimeDir, "config", "runtime-config.json"),
            "utf-8",
          ),
          "utf-8",
        );
        await rm(path.join(runtimeDir, "config"), { recursive: true });
        await symlink(externalConfig, path.join(runtimeDir, "config"), "dir");

        await expect(
          execFileAsync("bash", [
            path.join(runtimeDir, "scripts", "devcanon-runtime.sh"),
            "runtime",
            "config",
            "path",
          ]),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "invalid runtime configuration catalog",
          ),
        });
      } finally {
        await cleanupTempDir(tempDir);
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "rejects a symlinked runtime catalog file",
    async () => {
      const tempDir = await createTempDir();
      try {
        const runtimeDir = path.join(tempDir, "devcanon-runtime");
        const catalogPath = path.join(
          runtimeDir,
          "config",
          "runtime-config.json",
        );
        const externalCatalog = path.join(tempDir, "external-config.json");
        await cp(path.resolve("skills/devcanon-runtime"), runtimeDir, {
          recursive: true,
        });
        await writeFile(externalCatalog, JSON.stringify({}), "utf-8");
        await rm(catalogPath);
        await symlink(externalCatalog, catalogPath, "file");

        await expect(
          execFileAsync("bash", [
            path.join(runtimeDir, "scripts", "devcanon-runtime.sh"),
            "runtime",
            "config",
            "path",
          ]),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "invalid runtime configuration catalog",
          ),
        });
      } finally {
        await cleanupTempDir(tempDir);
      }
    },
  );

  it("packages every shared runtime helper module in the copied passive runtime bundle", async () => {
    const tempDir = await createTempDir();
    try {
      await cp(
        path.resolve("skills/devcanon-runtime"),
        path.join(tempDir, "devcanon-runtime"),
        { recursive: true },
      );

      const runtimeModule = await import(
        pathToFileURL(
          path.join(
            tempDir,
            "devcanon-runtime",
            "scripts",
            "runtime",
            "index.js",
          ),
        ).href
      );

      expect(runtimeModule).toMatchObject({
        assertNoSymlinkOrReparsePoint: expect.any(Function),
        gitRevParse: expect.any(Function),
        normalizeRuntimePath: expect.any(Function),
        runGit: expect.any(Function),
        runRuntimeCommand: expect.any(Function),
        validateRuntimeSchema: expect.any(Function),
        writeTextAtomically: expect.any(Function),
      });
      await expect(
        readFile(
          path.join(
            tempDir,
            "devcanon-runtime",
            "scripts",
            "runtime",
            "node_modules",
            "mdast-util-from-markdown",
            "license",
          ),
          "utf-8",
        ),
      ).resolves.toContain("MIT License");
    } finally {
      await cleanupTempDir(tempDir);
    }
  });
});
