import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  canCreateSymlinks,
  makeResolvedConfig,
} from "../__test-helpers__/fixtures.js";
import type { ModelTiers, SkillSource } from "../config/schema.js";
import type { LoadedSkill } from "../models/types.js";
import { sha256 } from "../utils/hash.js";
import { formatPackagedSymlinkHashEntry } from "./mirrored-files.js";
import { buildSkillContentHash, renderSkillForTarget } from "./skill.js";

const TIERS: ModelTiers = {
  fast: { claude: { model: "haiku" }, codex: { model: "gpt-5.4-mini" } },
  standard: { claude: { model: "sonnet" }, codex: { model: "gpt-5.4" } },
  deep: {
    claude: { model: "opus", effort: "high" },
    codex: { model: "gpt-5.4", reasoning_effort: "high" },
  },
};
const symlinkAvailable = await canCreateSymlinks();

function makeLoaded(source: SkillSource, body = "# body\n"): LoadedSkill {
  return {
    name: source.name,
    dirPath: `/tmp/skills/${source.name}`,
    skillMdContent: "",
    source,
    body,
    subdirs: [],
  };
}

function makeLoadedWithDir(
  source: SkillSource,
  dirPath: string,
  body = "# body\n",
  subdirs: string[] = [],
): LoadedSkill {
  return {
    name: source.name,
    dirPath,
    skillMdContent: "",
    source,
    body,
    subdirs,
  };
}

describe("renderSkillForTarget contentHash", () => {
  it("changes when only the codex sidecar changes (codex target)", () => {
    const config = makeResolvedConfig("/tmp/test-hash");
    config.modelTiers = TIERS;

    const baseSource: SkillSource = {
      name: "x",
      description: "d",
      codex_sidecar: { interface: { display_name: "Original" } },
    };
    const mutatedSource: SkillSource = {
      name: "x",
      description: "d",
      codex_sidecar: {
        interface: { display_name: "Original", brand_color: "#fff" },
      },
    };

    const baseRender = renderSkillForTarget(
      makeLoaded(baseSource),
      "codex",
      config,
    );
    const mutatedRender = renderSkillForTarget(
      makeLoaded(mutatedSource),
      "codex",
      config,
    );

    // SKILL.md content is unchanged (sidecar lives in a separate file),
    // but the hash must reflect sidecar mutation so plan computation
    // re-installs the skill.
    expect(baseRender.rendered.content).toBe(mutatedRender.rendered.content);
    expect(baseRender.rendered.contentHash).not.toBe(
      mutatedRender.rendered.contentHash,
    );
  });

  it("changes the codex hash but not the claude hash when only the display suffix is configured", () => {
    const baseConfig = makeResolvedConfig("/tmp/test-hash");
    baseConfig.modelTiers = TIERS;
    const suffixConfig = makeResolvedConfig("/tmp/test-hash", {
      codex: { skillDisplayNameSuffix: "devcanon" },
    });
    suffixConfig.modelTiers = TIERS;

    const source: SkillSource = {
      name: "branch-review",
      description: "d",
    };

    const baseCodex = renderSkillForTarget(
      makeLoaded(source),
      "codex",
      baseConfig,
    );
    const suffixCodex = renderSkillForTarget(
      makeLoaded(source),
      "codex",
      suffixConfig,
    );
    const baseClaude = renderSkillForTarget(
      makeLoaded(source),
      "claude",
      baseConfig,
    );
    const suffixClaude = renderSkillForTarget(
      makeLoaded(source),
      "claude",
      suffixConfig,
    );

    expect(baseCodex.extraFiles.size).toBe(0);
    expect(suffixCodex.extraFiles.size).toBe(1);
    expect(Array.from(suffixCodex.extraFiles.values())[0]).toContain(
      "display_name: Branch Review (devcanon)",
    );
    expect(baseCodex.rendered.contentHash).not.toBe(
      suffixCodex.rendered.contentHash,
    );
    expect(baseClaude.rendered.content).toBe(suffixClaude.rendered.content);
    expect(baseClaude.rendered.contentHash).toBe(
      suffixClaude.rendered.contentHash,
    );
  });

  it("changes when only the claude override changes (claude target)", () => {
    const config = makeResolvedConfig("/tmp/test-hash");
    config.modelTiers = TIERS;

    const baseSource: SkillSource = {
      name: "x",
      description: "d",
      claude: { model: "sonnet" },
    };
    const mutatedSource: SkillSource = {
      name: "x",
      description: "d",
      claude: { model: "opus" },
    };

    const baseRender = renderSkillForTarget(
      makeLoaded(baseSource),
      "claude",
      config,
    );
    const mutatedRender = renderSkillForTarget(
      makeLoaded(mutatedSource),
      "claude",
      config,
    );

    expect(baseRender.rendered.contentHash).not.toBe(
      mutatedRender.rendered.contentHash,
    );
  });

  it("is deterministic across renders of the same source+sidecar", () => {
    const config = makeResolvedConfig("/tmp/test-hash");
    config.modelTiers = TIERS;

    const source: SkillSource = {
      name: "x",
      description: "d",
      codex_sidecar: { interface: { display_name: "Stable" } },
    };
    const a = renderSkillForTarget(makeLoaded(source), "codex", config);
    const b = renderSkillForTarget(makeLoaded(source), "codex", config);
    expect(a.rendered.contentHash).toBe(b.rendered.contentHash);
  });

  it("uses POSIX-normalized relative paths in the sidecar hash", () => {
    // The hash must not depend on the host's path separator. We pin it to
    // the POSIX representation by reproducing the implementation's recipe
    // with `agents/openai.yaml` (forward-slash) and asserting equality. A
    // regression that hashed `agents\openai.yaml` on Windows would diverge.
    const config = makeResolvedConfig("/tmp/test-hash");
    config.modelTiers = TIERS;

    const source: SkillSource = {
      name: "x",
      description: "d",
      codex_sidecar: { interface: { display_name: "Stable" } },
    };
    const rendered = renderSkillForTarget(
      makeLoaded(source),
      "codex",
      config,
    ).rendered;

    const sidecarYaml = "interface:\n  display_name: Stable\n";
    const expected = sha256(
      [rendered.content, "agents/openai.yaml", sidecarYaml].join("\0"),
    );
    expect(rendered.contentHash).toBe(expected);
  });

  it("isolates claude override changes from codex hash", () => {
    // A `claude:` override change must flip the claude hash but never the
    // codex hash. If a regression bled claude overrides into the codex
    // render path, both hashes would change. Both blocks are populated
    // so a regression that hashed the entire SkillSource (rather than the
    // per-target render) would also be caught.
    const config = makeResolvedConfig("/tmp/test-hash");
    config.modelTiers = TIERS;

    const baseSource: SkillSource = {
      name: "x",
      description: "d",
      claude: { model: "sonnet" },
      codex_sidecar: { interface: { display_name: "Original" } },
    };
    const mutatedSource: SkillSource = {
      name: "x",
      description: "d",
      claude: { model: "opus" },
      codex_sidecar: { interface: { display_name: "Original" } },
    };

    const baseClaude = renderSkillForTarget(
      makeLoaded(baseSource),
      "claude",
      config,
    ).rendered;
    const mutatedClaude = renderSkillForTarget(
      makeLoaded(mutatedSource),
      "claude",
      config,
    ).rendered;
    const baseCodex = renderSkillForTarget(
      makeLoaded(baseSource),
      "codex",
      config,
    ).rendered;
    const mutatedCodex = renderSkillForTarget(
      makeLoaded(mutatedSource),
      "codex",
      config,
    ).rendered;

    expect(baseClaude.contentHash).not.toBe(mutatedClaude.contentHash);
    expect(baseCodex.contentHash).toBe(mutatedCodex.contentHash);
  });

  it("isolates codex sidecar changes from claude hash", () => {
    // Symmetric: a `codex_sidecar:` mutation must flip the codex hash but
    // leave the claude hash untouched. Both blocks are populated so a
    // regression that hashed the entire SkillSource (rather than the
    // per-target render) would also be caught.
    const config = makeResolvedConfig("/tmp/test-hash");
    config.modelTiers = TIERS;

    const baseSource: SkillSource = {
      name: "x",
      description: "d",
      claude: { model: "sonnet" },
      codex_sidecar: { interface: { display_name: "Original" } },
    };
    const mutatedSource: SkillSource = {
      name: "x",
      description: "d",
      claude: { model: "sonnet" },
      codex_sidecar: {
        interface: { display_name: "Original", brand_color: "#fff" },
      },
    };

    const baseCodex = renderSkillForTarget(
      makeLoaded(baseSource),
      "codex",
      config,
    ).rendered;
    const mutatedCodex = renderSkillForTarget(
      makeLoaded(mutatedSource),
      "codex",
      config,
    ).rendered;
    const baseClaude = renderSkillForTarget(
      makeLoaded(baseSource),
      "claude",
      config,
    ).rendered;
    const mutatedClaude = renderSkillForTarget(
      makeLoaded(mutatedSource),
      "claude",
      config,
    ).rendered;

    expect(baseCodex.contentHash).not.toBe(mutatedCodex.contentHash);
    expect(baseClaude.contentHash).toBe(mutatedClaude.contentHash);
  });

  it("changes when a mirrored scripts file changes", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "am-skill-hash-"));
    try {
      const skillDir = path.join(tempDir, "skills", "issue-worktree-setup");
      const scriptsDir = path.join(skillDir, "scripts");
      mkdirSync(scriptsDir, { recursive: true });

      const source: SkillSource = {
        name: "issue-worktree-setup",
        description: "d",
      };
      const config = makeResolvedConfig(tempDir);
      config.modelTiers = TIERS;

      writeFileSync(path.join(scriptsDir, "setup-worktree.sh"), "echo old\n");
      const baseRendered = renderSkillForTarget(
        makeLoadedWithDir(source, skillDir, "# body\n", ["scripts"]),
        "claude",
        config,
      ).rendered;

      writeFileSync(path.join(scriptsDir, "setup-worktree.sh"), "echo new\n");
      const mutatedRendered = renderSkillForTarget(
        makeLoadedWithDir(source, skillDir, "# body\n", ["scripts"]),
        "claude",
        config,
      ).rendered;

      expect(baseRendered.content).toBe(mutatedRendered.content);
      expect(baseRendered.contentHash).not.toBe(mutatedRendered.contentHash);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it.skipIf(!symlinkAvailable)(
    "hashes mirrored symlinks by link target and kind without traversing them",
    async () => {
      const tempDir = mkdtempSync(path.join(os.tmpdir(), "am-skill-symlink-"));
      try {
        const skillDir = path.join(tempDir, "skills", "issue-worktree-setup");
        const scriptsDir = path.join(skillDir, "scripts");
        const targetDirA = path.join(skillDir, "target-a");
        const targetDirB = path.join(skillDir, "target-b");
        const linkPath = path.join(scriptsDir, "tool-link");
        mkdirSync(scriptsDir, { recursive: true });
        mkdirSync(targetDirA, { recursive: true });
        mkdirSync(targetDirB, { recursive: true });

        const source: SkillSource = {
          name: "issue-worktree-setup",
          description: "d",
        };
        const config = makeResolvedConfig(tempDir);
        config.modelTiers = TIERS;

        writeFileSync(path.join(targetDirA, "payload.txt"), "alpha\n");
        writeFileSync(path.join(targetDirB, "payload.txt"), "beta\n");
        symlinkSync("../target-a", linkPath);

        const baseRendered = renderSkillForTarget(
          makeLoadedWithDir(source, skillDir, "# body\n", ["scripts"]),
          "claude",
          config,
        ).rendered;

        writeFileSync(path.join(targetDirA, "payload.txt"), "changed\n");
        const unchangedTargetRendered = renderSkillForTarget(
          makeLoadedWithDir(source, skillDir, "# body\n", ["scripts"]),
          "claude",
          config,
        ).rendered;

        rmSync(linkPath);
        symlinkSync("../target-b", linkPath);
        const retargetedRendered = renderSkillForTarget(
          makeLoadedWithDir(source, skillDir, "# body\n", ["scripts"]),
          "claude",
          config,
        ).rendered;

        expect(baseRendered.contentHash).toBe(
          unchangedTargetRendered.contentHash,
        );
        expect(baseRendered.contentHash).not.toBe(
          retargetedRendered.contentHash,
        );
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!symlinkAvailable)(
    "changes when a mirrored symlink kind changes with the same target spelling",
    async () => {
      const tempDir = mkdtempSync(
        path.join(os.tmpdir(), "am-skill-symlink-kind-"),
      );
      try {
        const skillDir = path.join(tempDir, "skills", "issue-worktree-setup");
        const scriptsDir = path.join(skillDir, "scripts");
        const externalDir = path.join(tempDir, "external");
        const externalTarget = path.join(externalDir, "target");
        const linkPath = path.join(scriptsDir, "tool-link");
        const targetSpelling = path.relative(scriptsDir, externalTarget);
        mkdirSync(scriptsDir, { recursive: true });
        mkdirSync(externalDir, { recursive: true });

        const source: SkillSource = {
          name: "issue-worktree-setup",
          description: "d",
        };
        const config = makeResolvedConfig(tempDir);
        config.modelTiers = TIERS;

        writeFileSync(externalTarget, "alpha\n");
        symlinkSync(targetSpelling, linkPath, "file");

        const baseRendered = renderSkillForTarget(
          makeLoadedWithDir(source, skillDir, "# body\n", ["scripts"]),
          "claude",
          config,
        ).rendered;

        writeFileSync(externalTarget, "changed\n");
        const changedTargetContentRendered = renderSkillForTarget(
          makeLoadedWithDir(source, skillDir, "# body\n", ["scripts"]),
          "claude",
          config,
        ).rendered;

        rmSync(externalTarget, { force: true });
        mkdirSync(externalTarget, { recursive: true });
        rmSync(linkPath);
        symlinkSync(targetSpelling, linkPath, "dir");
        const changedKindRendered = renderSkillForTarget(
          makeLoadedWithDir(source, skillDir, "# body\n", ["scripts"]),
          "claude",
          config,
        ).rendered;

        expect(baseRendered.contentHash).toBe(
          changedTargetContentRendered.contentHash,
        );
        expect(baseRendered.contentHash).not.toBe(
          changedKindRendered.contentHash,
        );
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    },
  );

  it("uses a distinct namespace for typed mirrored symlink hashes", () => {
    expect(formatPackagedSymlinkHashEntry("payload", "file")).not.toBe(
      "symlink:file:payload",
    );
    expect(formatPackagedSymlinkHashEntry("file:payload", "file")).not.toBe(
      "symlink:file:payload",
    );
    expect(formatPackagedSymlinkHashEntry("dir:payload", "dir")).not.toBe(
      "symlink:dir:payload",
    );
  });
});

describe("buildSkillContentHash", () => {
  it("sorts extra-files by byte order, not locale collation", () => {
    // Byte-wise: "B" (0x42) sorts before "a" (0x61).
    // localeCompare (case-insensitive then case-tiebreak) would put "a"
    // first, producing a different hash.
    // A nested path is included to also pin POSIX-separator normalization:
    // the relative key in the hash must be `sub/x`, not `sub\\x`.
    const generatedDir = "/g";
    const extraFiles = new Map([
      [path.join("/g", "a"), "a-content"],
      [path.join("/g", "B"), "B-content"],
      [path.join("/g", "sub", "x"), "x-content"],
    ]);
    // Byte-wise sort over the POSIX-normalized relative keys yields:
    //   "B" (0x42) < "a" (0x61) < "sub/x" (starts with 0x73)
    const expected = sha256(
      ["body", "B", "B-content", "a", "a-content", "sub/x", "x-content"].join(
        "\0",
      ),
    );
    expect(buildSkillContentHash("body", extraFiles, generatedDir)).toBe(
      expected,
    );
  });
});
