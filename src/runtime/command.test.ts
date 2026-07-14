import { describe, expect, it } from "vitest";
import { runRuntimeCommand } from "./command.js";

describe("runtime command helpers", () => {
  it("reports a stable command contract", async () => {
    await expect(runRuntimeCommand(["contract"])).resolves.toEqual({
      exitCode: 0,
      stdout:
        '{"command_group":"devcanon-runtime","major_version":1,"helper_foundation":true}\n',
      stderr: "",
    });
  });

  it("returns parseable path facts", async () => {
    const result = await runRuntimeCommand([
      "path-info",
      "--path",
      "C:\\Temp\\..\\Agent\\File.txt",
      "--platform",
      "win32",
    ]);

    expect(JSON.parse(result.stdout)).toMatchObject({
      normalized: "C:\\Agent\\File.txt",
      comparable: "c:/agent/file.txt",
      isAbsolute: true,
    });
  });

  it("returns stable stderr fragments for invalid paths", async () => {
    await expect(
      runRuntimeCommand(["ephemeral-child", "--path", "outside.json"]),
    ).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr:
        '{"ok":false,"code":"outside-ephemeral","message":"path must be a direct child under .ephemeral"}\n',
    });
  });

  it("rejects POSIX backslashes before accepting ephemeral children", async () => {
    await expect(
      runRuntimeCommand([
        "ephemeral-child",
        "--path",
        ".ephemeral\\result.json",
      ]),
    ).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr:
        '{"ok":false,"code":"invalid-separator","message":"path must use POSIX separators"}\n',
    });
  });

  it("fails malformed command envelopes", async () => {
    await expect(
      runRuntimeCommand([
        "validate-json",
        "--schema",
        "command-envelope",
        "--payload",
        '{"notCommand":true}',
      ]),
    ).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr:
        '{"ok":false,"code":"invalid-command-envelope","message":"command is required"}\n',
    });
  });

  it("fails invalid JSON command envelopes", async () => {
    await expect(
      runRuntimeCommand([
        "validate-json",
        "--schema",
        "command-envelope",
        "--payload",
        "{",
      ]),
    ).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr:
        '{"ok":false,"code":"invalid-json","message":"payload must be valid JSON"}\n',
    });
  });

  it("rejects unknown path platforms with stable stderr JSON", async () => {
    await expect(
      runRuntimeCommand([
        "path-info",
        "--path",
        "/tmp/result.json",
        "--platform",
        "plan9",
      ]),
    ).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr:
        '{"ok":false,"code":"runtime-error","message":"unknown platform: plan9"}\n',
    });
  });

  it("routes source-immutability command parsing failures with plain stderr", async () => {
    await expect(
      runRuntimeCommand(["source-immutability", "verify"]),
    ).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "verify requires --baseline\n",
    });
  });

  it("rejects duplicate source-immutability handoff declarations", async () => {
    await expect(
      runRuntimeCommand([
        "source-immutability",
        "capture",
        "--handoff",
        ".ephemeral/one.json",
        "--handoff",
        ".ephemeral/two.json",
      ]),
    ).resolves.toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "--handoff may be supplied only once\n",
    });
  });
});
