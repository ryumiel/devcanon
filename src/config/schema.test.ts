import { describe, expect, it } from "vitest";
import { AgentSourceSchema, ConfigSchema } from "./schema.js";

describe("ConfigSchema", () => {
  it("parses valid minimal config (version 1 only)", () => {
    const result = ConfigSchema.safeParse({ version: 1 });
    expect(result.success).toBe(true);
  });

  it("rejects missing version", () => {
    const result = ConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects version 2", () => {
    const result = ConfigSchema.safeParse({ version: 2 });
    expect(result.success).toBe(false);
  });

  it("applies correct defaults", () => {
    const result = ConfigSchema.parse({ version: 1 });

    expect(result.library.skillsDir).toBe("./skills");
    expect(result.library.agentsDir).toBe("./agents");
    expect(result.library.generatedDir).toBe("./generated");

    expect(result.targets.claude.enabled).toBe(true);
    expect(result.targets.claude.skillsHome).toBe("~/.claude/skills");
    expect(result.targets.claude.agentsHome).toBe("~/.claude/agents");

    expect(result.targets.codex.enabled).toBe(true);
    expect(result.targets.codex.skillsHome).toBe("~/.agents/skills");
    expect(result.targets.codex.agentsHome).toBe("~/.codex/agents");

    expect(result.defaults.installMode).toBe("symlink");
    expect(result.defaults.overwritePolicy).toBe("overwrite-managed");
    expect(result.defaults.cleanManagedOutputs).toBe(true);

    expect(result.platform.windowsSymlinkFallback).toBe("copy");

    expect(result.manifest.path).toBe("~/.agents-manager/manifest.json");
  });
});

describe("AgentSourceSchema", () => {
  const validAgent = {
    name: "my-agent",
    description: "A helpful agent.",
    instructions: "Do things well.",
  };

  it("parses valid agent", () => {
    const result = AgentSourceSchema.safeParse(validAgent);
    expect(result.success).toBe(true);
  });

  it("rejects missing name", () => {
    const { name: _, ...noName } = validAgent;
    const result = AgentSourceSchema.safeParse(noName);
    expect(result.success).toBe(false);
  });

  it("rejects missing instructions", () => {
    const { instructions: _, ...noInstructions } = validAgent;
    const result = AgentSourceSchema.safeParse(noInstructions);
    expect(result.success).toBe(false);
  });

  it("rejects missing description", () => {
    const { description: _, ...noDesc } = validAgent;
    const result = AgentSourceSchema.safeParse(noDesc);
    expect(result.success).toBe(false);
  });

  it("accepts optional fields (tags, notes, skills)", () => {
    const result = AgentSourceSchema.parse({
      ...validAgent,
      tags: ["coding", "review"],
      notes: "Some notes here.",
      skills: ["skill-a", "skill-b"],
    });
    expect(result.tags).toEqual(["coding", "review"]);
    expect(result.notes).toBe("Some notes here.");
    expect(result.skills).toEqual(["skill-a", "skill-b"]);
  });

  it("defaults skills to empty array", () => {
    const result = AgentSourceSchema.parse(validAgent);
    expect(result.skills).toEqual([]);
  });

  it("rejects invalid name with spaces", () => {
    const result = AgentSourceSchema.safeParse({
      ...validAgent,
      name: "my agent",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid name with uppercase", () => {
    const result = AgentSourceSchema.safeParse({
      ...validAgent,
      name: "MyAgent",
    });
    expect(result.success).toBe(false);
  });
});
