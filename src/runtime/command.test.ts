import { describe, expect, it } from "vitest";
import { runRuntimeCommand } from "./command.js";

describe("runtime command helpers", () => {
  it("reports a stable command contract", () => {
    expect(runRuntimeCommand(["contract"])).toEqual({
      exitCode: 0,
      stdout:
        '{"command_group":"devcanon-runtime","major_version":1,"helper_foundation":true}\n',
      stderr: "",
    });
  });

  it("returns parseable path facts", () => {
    const result = runRuntimeCommand([
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

  it("returns stable stderr fragments for invalid paths", () => {
    expect(
      runRuntimeCommand(["ephemeral-child", "--path", "outside.json"]),
    ).toEqual({
      exitCode: 1,
      stdout: "",
      stderr:
        '{"ok":false,"code":"outside-ephemeral","message":"path must be a direct child under .ephemeral"}\n',
    });
  });

  it("rejects unknown path platforms with stable stderr JSON", () => {
    expect(
      runRuntimeCommand([
        "path-info",
        "--path",
        "/tmp/result.json",
        "--platform",
        "plan9",
      ]),
    ).toEqual({
      exitCode: 1,
      stdout: "",
      stderr:
        '{"ok":false,"code":"runtime-error","message":"unknown platform: plan9"}\n',
    });
  });
});
