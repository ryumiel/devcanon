import { mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupTempDir,
  createSkillFixture,
  createTempDir,
} from "../__test-helpers__/fixtures.js";
import { loadAndValidateSkills } from "../validate/skills.js";
import { readDeclaredSupportFile } from "./files.js";

describe("analysis support files", () => {
  const temporary: string[] = [];

  afterEach(async () => {
    await Promise.all(temporary.splice(0).map(cleanupTempDir));
  });

  it("reads only a declared regular support file and preserves raw identity", async () => {
    const root = await createTempDir();
    temporary.push(root);
    const skills = path.join(root, "skills");
    const directory = await createSkillFixture(skills, "example", undefined, [
      "scripts",
    ]);
    await writeFile(
      path.join(directory, "scripts", "tool.sh"),
      Buffer.from("#!/bin/sh\r\necho exact\r\n", "utf8"),
    );
    const [skill] = await loadAndValidateSkills(skills);

    const support = await readDeclaredSupportFile({
      skill,
      target: "codex",
      path: "scripts/tool.sh",
    });

    expect(support.rawBytes.toString("utf8")).toBe(
      "#!/bin/sh\r\necho exact\r\n",
    );
    expect(support.targetText).toBe("#!/bin/sh\necho exact\n");
    expect(support.rawBytesSha256).not.toBe(support.targetTextSha256);
  });

  it("refuses traversal and a symlinked declared leaf", async () => {
    const root = await createTempDir();
    temporary.push(root);
    const skills = path.join(root, "skills");
    const directory = await createSkillFixture(skills, "example", undefined, [
      "references",
    ]);
    await writeFile(path.join(root, "outside.md"), "outside", "utf8");
    await symlink(
      path.join(root, "outside.md"),
      path.join(directory, "references", "linked.md"),
    );
    const [skill] = await loadAndValidateSkills(skills);

    await expect(
      readDeclaredSupportFile({
        skill,
        target: "claude",
        path: "../outside.md",
      }),
    ).rejects.toThrow("relative");
    await expect(
      readDeclaredSupportFile({
        skill,
        target: "claude",
        path: "references/linked.md",
      }),
    ).rejects.toThrow("symlink");
  });

  it("refuses every malformed, nonregular, escaped, and invalid UTF-8 declaration", async () => {
    const root = await createTempDir();
    temporary.push(root);
    const skills = path.join(root, "skills");
    const directory = await createSkillFixture(skills, "example", undefined, [
      "references",
    ]);
    await mkdir(path.join(directory, "references", "directory"));
    await writeFile(
      path.join(directory, "references", "invalid.md"),
      Buffer.from([0xff]),
    );
    await mkdir(path.join(root, "outside"));
    await symlink(
      path.join(root, "outside"),
      path.join(directory, "references", "escape"),
    );
    const [skill] = await loadAndValidateSkills(skills);

    for (const declared of [
      "",
      "/absolute.md",
      "references\\windows.md",
      "references//empty.md",
      "references/./dot.md",
      "references/../parent.md",
      "SKILL.md",
      "references/directory",
      "references/escape/value.md",
      "references/invalid.md",
    ]) {
      await expect(
        readDeclaredSupportFile({ skill, target: "codex", path: declared }),
      ).rejects.toThrow();
    }
  });

  it("preserves BOM, CRLF, trailing bytes, and a missing final newline for non-shell support", async () => {
    const root = await createTempDir();
    temporary.push(root);
    const skills = path.join(root, "skills");
    const directory = await createSkillFixture(skills, "example", undefined, [
      "references",
    ]);
    const bytes = Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0x0d, 0x0a, 0x62]);
    await writeFile(path.join(directory, "references", "exact.md"), bytes);
    const [skill] = await loadAndValidateSkills(skills);

    const support = await readDeclaredSupportFile({
      skill,
      target: "claude",
      path: "references/exact.md",
    });

    expect(support.rawBytes).toEqual(bytes);
    expect(support.targetText).toBe("\ufeffa\r\nb");
    expect(support.rawBytesSha256).toBe(support.targetTextSha256);
  });
});
