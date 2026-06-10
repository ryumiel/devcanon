import { defineConfig } from "vitest/config";

const integrationTestTimeout = process.platform === "win32" ? 120_000 : 10_000;
const maxConcurrency = process.platform === "win32" ? 4 : 5;

export default defineConfig({
  test: {
    globals: false,
    maxConcurrency,
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
          name: "integration",
          include: ["src/**/*.integration.test.ts"],
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
