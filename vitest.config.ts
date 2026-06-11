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
  "src/skill-scripts/devcanon-runtime-*.integration.test.ts",
  "src/skill-scripts/pr-merge-worktree-helpers.integration.test.ts",
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
