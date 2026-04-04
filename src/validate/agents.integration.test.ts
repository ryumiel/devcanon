import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupTempDir,
  createAgentFixture,
  createTempDir,
  makeAgentYaml,
} from "../__test-helpers__/fixtures.js";
import { installTestLogger } from "../__test-helpers__/logger.js";
import type { TestLoggerResult } from "../__test-helpers__/logger.js";
import type { LoadedSkill } from "../models/types.js";
import { UserError } from "../utils/errors.js";
import { loadAndValidateAgents } from "./agents.js";

describe("loadAndValidateAgents", () => {
  let tempDir: string;
  let agentsDir: string;
  let testLogger: TestLoggerResult;
  let restore: () => void;

  beforeEach(async () => {
    tempDir = await createTempDir();
    agentsDir = path.join(tempDir, "agents");
    const installed = installTestLogger();
    testLogger = installed.testLogger;
    restore = installed.restore;
  });

  afterEach(async () => {
    restore();
    await cleanupTempDir(tempDir);
  });

  const noSkills: LoadedSkill[] = [];

  it("returns empty array when agents directory does not exist", async () => {
    const result = await loadAndValidateAgents(
      path.join(tempDir, "nonexistent"),
      noSkills,
    );
    expect(result).toEqual([]);
  });

  it("returns empty array for an empty agents directory", async () => {
    await mkdir(agentsDir, { recursive: true });
    const result = await loadAndValidateAgents(agentsDir, noSkills);
    expect(result).toEqual([]);
  });

  it("loads a single valid agent with correct LoadedAgent fields", async () => {
    const yaml = makeAgentYaml("my-agent");
    const filePath = await createAgentFixture(agentsDir, "my-agent", yaml);

    const result = await loadAndValidateAgents(agentsDir, noSkills);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("my-agent");
    expect(result[0].filePath).toBe(filePath);
    expect(result[0].source.description).toBe("Test agent my-agent");
    expect(result[0].source.instructions).toBe("Instructions for my-agent");
    expect(result[0].source.skills).toEqual([]);
  });

  it("throws UserError for invalid YAML syntax", async () => {
    await createAgentFixture(agentsDir, "bad", "name: [\ninvalid yaml");

    await expect(loadAndValidateAgents(agentsDir, noSkills)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(UserError);
        expect((err as UserError).message).toContain("invalid YAML");
        return true;
      },
    );
  });

  it("throws UserError when a required field is missing", async () => {
    const yaml = "name: test-agent\ndescription: A test agent\nskills: []";
    await createAgentFixture(agentsDir, "no-instructions", yaml);

    await expect(loadAndValidateAgents(agentsDir, noSkills)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(UserError);
        expect((err as UserError).message).toContain("no-instructions.yaml");
        return true;
      },
    );
  });

  it("throws UserError when name field is not filesystem-safe", async () => {
    const yaml = makeAgentYaml("BadName", {
      name: "BadName",
    });
    await createAgentFixture(agentsDir, "uppercase", yaml);

    await expect(loadAndValidateAgents(agentsDir, noSkills)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(UserError);
        expect((err as UserError).message).toContain("filesystem-safe");
        return true;
      },
    );
  });

  it("throws UserError when agent references an unknown skill", async () => {
    const yaml = makeAgentYaml("ref-agent", {
      skills: ["nonexistent-skill"],
    });
    await createAgentFixture(agentsDir, "ref-agent", yaml);

    await expect(loadAndValidateAgents(agentsDir, noSkills)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(UserError);
        expect((err as UserError).message).toContain("nonexistent-skill");
        return true;
      },
    );
  });

  it("succeeds when agent references a valid skill", async () => {
    const skill: LoadedSkill = {
      name: "my-skill",
      dirPath: "/fake",
      skillMdContent: "# my-skill",
      subdirs: [],
    };
    const yaml = makeAgentYaml("skill-user", {
      skills: ["my-skill"],
    });
    await createAgentFixture(agentsDir, "skill-user", yaml);

    const result = await loadAndValidateAgents(agentsDir, [skill]);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("skill-user");
    expect(result[0].source.skills).toEqual(["my-skill"]);
  });

  it("returns agent with warning for unknown field in non-strict mode", async () => {
    const yaml = `${makeAgentYaml("warn-agent")}\nextra_field: surprise`;
    await createAgentFixture(agentsDir, "warn-agent", yaml);

    const result = await loadAndValidateAgents(agentsDir, noSkills, false);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("warn-agent");
    expect(testLogger.warnings.some((w) => w.includes("extra_field"))).toBe(
      true,
    );
  });

  it("throws UserError for unknown field in strict mode", async () => {
    const yaml = `${makeAgentYaml("strict-agent")}\nextra_field: surprise`;
    await createAgentFixture(agentsDir, "strict-agent", yaml);

    await expect(
      loadAndValidateAgents(agentsDir, noSkills, true),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(UserError);
      expect((err as UserError).message).toContain("extra_field");
      return true;
    });
  });

  it("warns about .yml files and does not load them", async () => {
    await mkdir(agentsDir, { recursive: true });
    await writeFile(
      path.join(agentsDir, "ignored.yml"),
      makeAgentYaml("ignored"),
      "utf-8",
    );

    const result = await loadAndValidateAgents(agentsDir, noSkills);

    expect(result).toEqual([]);
    expect(testLogger.warnings.some((w) => w.includes("ignored.yml"))).toBe(
      true,
    );
    expect(testLogger.warnings.some((w) => w.includes(".yaml"))).toBe(true);
  });

  it("throws UserError mentioning duplicate when two files share the same name field", async () => {
    const yamlA = makeAgentYaml("same-name");
    const yamlB = makeAgentYaml("same-name");
    await createAgentFixture(agentsDir, "alpha", yamlA);
    await createAgentFixture(agentsDir, "beta", yamlB);

    await expect(loadAndValidateAgents(agentsDir, noSkills)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(UserError);
        expect((err as UserError).message.toLowerCase()).toContain("duplicate");
        return true;
      },
    );
  });

  it("ignores non-YAML files and returns empty array", async () => {
    await mkdir(agentsDir, { recursive: true });
    await writeFile(path.join(agentsDir, "readme.txt"), "hello", "utf-8");
    await writeFile(
      path.join(agentsDir, "notes.json"),
      JSON.stringify({ a: 1 }),
      "utf-8",
    );

    const result = await loadAndValidateAgents(agentsDir, noSkills);

    expect(result).toEqual([]);
  });

  it("batches multiple errors into a single UserError", async () => {
    // Agent with invalid YAML
    await createAgentFixture(agentsDir, "broken", "name: [\nbad yaml");
    // Agent with non-filesystem-safe name
    await createAgentFixture(
      agentsDir,
      "upper",
      makeAgentYaml("Upper", { name: "Upper" }),
    );

    await expect(loadAndValidateAgents(agentsDir, noSkills)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(UserError);
        const msg = (err as UserError).message;
        expect(msg).toContain("broken.yaml");
        expect(msg).toContain("upper.yaml");
        return true;
      },
    );
  });
});
