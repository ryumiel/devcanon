import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("CLI entrypoint", () => {
  it("uses devcanon as the program name in help output", async () => {
    const result = await execFileAsync(
      "pnpm",
      ["exec", "tsx", "src/cli/index.ts", "--help"],
      {
        cwd: process.cwd(),
      },
    );

    expect(result.stdout).toContain("Usage: devcanon");
  });
});
