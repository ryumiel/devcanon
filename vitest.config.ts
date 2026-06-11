import { defineConfig } from "vitest/config";

const integrationTestTimeout = process.platform === "win32" ? 60000 : 10000;
const renderInstallIntegrationIncludes = [
  "src/config/*.integration.test.ts",
  "src/diff/*.integration.test.ts",
  "src/install/*.integration.test.ts",
  "src/render/*.integration.test.ts",
  "src/utils/*.integration.test.ts",
  "src/validate/*.integration.test.ts",
];
const windowsHelperIntegrationIncludes = [
  // Runtime helpers normalize Windows paths and exercise shell-backed adapters.
  "src/skill-scripts/devcanon-runtime-*.integration.test.ts",
  // Issue worktree setup validates Windows worktree path and shell behavior.
  "src/skill-scripts/issue-worktree-setup.integration.test.ts",
  // Native helper coverage keeps the Node worktree adapter in the Windows lane.
  "src/skill-scripts/issue-worktree-setup-windows-helper.integration.test.ts",
  // PR merge cleanup/preflight helpers exercise Windows worktree and PATH handling.
  "src/skill-scripts/pr-merge-worktree-helpers.integration.test.ts",
  // Review manifest helpers validate Windows-aware path normalization and repo roots.
  "src/skill-scripts/pr-review-manifests-helper.integration.test.ts",
];
const windowsIntegrationIncludes = [
  ...renderInstallIntegrationIncludes,
  ...windowsHelperIntegrationIncludes,
];

export default defineConfig({
  test: {
    globals: false,
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: "unit",
          include: ["src/**/*.test.ts", "src/**/*.spec.ts"],
          exclude: ["src/**/*.integration.test.ts"],
        },
      },
      {
        test: {
          name: "integration-posix",
          include: ["src/**/*.integration.test.ts"],
          exclude: windowsIntegrationIncludes,
          testTimeout: integrationTestTimeout,
          hookTimeout: integrationTestTimeout,
        },
      },
      {
        test: {
          name: "integration-render-install",
          include: renderInstallIntegrationIncludes,
          testTimeout: integrationTestTimeout,
          hookTimeout: integrationTestTimeout,
        },
      },
      {
        test: {
          name: "integration-windows-helper",
          include: windowsHelperIntegrationIncludes,
          testTimeout: integrationTestTimeout,
          hookTimeout: integrationTestTimeout,
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.spec.ts"],
    },
  },
});
