import { execFile } from "node:child_process";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupTempDir,
  createSkillFixture,
  createTempDir,
  makeResolvedConfig,
} from "../__test-helpers__/fixtures.js";
import { loadAndValidateAgents } from "../validate/agents.js";
import { loadAndValidateSkills } from "../validate/skills.js";
import { runSkillContextAnalysis } from "./runner.js";

const run = promisify(execFile);

describe("write-disabled analysis runner", () => {
  const temporary: string[] = [];

  afterEach(async () => {
    await Promise.all(temporary.splice(0).map(cleanupTempDir));
  });

  it("uses supplied validated inputs, renders without generated writes, and publishes one canonical result", async () => {
    const root = await createTempDir();
    temporary.push(root);
    await run("git", ["init", "-q", root]);
    await writeFile(path.join(root, ".gitignore"), ".ephemeral/\n", "utf8");
    await mkdir(path.join(root, ".ephemeral", "analysis"), { recursive: true });
    const config = makeResolvedConfig(root);
    const directory = await createSkillFixture(
      config.library.skillsDir,
      "example",
      undefined,
      ["references"],
    );
    await writeFile(
      path.join(directory, "references", "guide.md"),
      "guide\n",
      "utf8",
    );
    await mkdir(config.library.agentsDir, { recursive: true });
    await mkdir(config.library.generatedDir, { recursive: true });
    await mkdir(config.targets.codex.skillsHome, { recursive: true });
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    const generatedSentinel = path.join(
      config.library.generatedDir,
      "keep.txt",
    );
    const installedSentinel = path.join(
      config.targets.codex.skillsHome,
      "keep.txt",
    );
    await writeFile(generatedSentinel, "generated", "utf8");
    await writeFile(installedSentinel, "installed", "utf8");
    await writeFile(config.manifest.path, "manifest", "utf8");
    const skills = await loadAndValidateSkills(config.library.skillsDir);
    const agents = await loadAndValidateAgents(
      config.library.agentsDir,
      skills,
    );

    const result = await runSkillContextAnalysis({
      config,
      skills,
      agents,
      skill: "example",
      subject: "candidate",
      targets: ["codex"],
      scenarios: [
        {
          name: "full",
          target: "codex",
          supportPaths: ["references/guide.md"],
        },
      ],
      repositoryRoot: root,
      resultDirectory: path.join(root, ".ephemeral", "analysis"),
    });

    expect(result.path).toMatch(
      /^\.ephemeral\/analysis\/analysis-[a-f0-9]{64}\.json$/u,
    );
    expect(await readFile(path.join(root, result.path))).toEqual(
      result.envelope.bytes,
    );
    const repeated = await runSkillContextAnalysis({
      config,
      skills,
      agents,
      skill: "example",
      subject: "candidate",
      targets: ["codex"],
      scenarios: [
        {
          name: "full",
          target: "codex",
          supportPaths: ["references/guide.md"],
        },
      ],
      repositoryRoot: root,
      resultDirectory: path.join(root, ".ephemeral", "analysis"),
    });
    expect(repeated.payloadSha256).toBe(result.payloadSha256);
    expect(repeated.envelope.bytes).toEqual(result.envelope.bytes);
    await expect(readFile(generatedSentinel, "utf8")).resolves.toBe(
      "generated",
    );
    await expect(readFile(installedSentinel, "utf8")).resolves.toBe(
      "installed",
    );
    await expect(readFile(config.manifest.path, "utf8")).resolves.toBe(
      "manifest",
    );
  });

  it("refuses a noncanonical comparison before publishing a current result", async () => {
    const root = await createTempDir();
    temporary.push(root);
    await run("git", ["init", "-q", root]);
    await writeFile(path.join(root, ".gitignore"), ".ephemeral/\n", "utf8");
    const results = path.join(root, ".ephemeral", "analysis");
    await mkdir(results, { recursive: true });
    const config = makeResolvedConfig(root);
    await createSkillFixture(config.library.skillsDir, "example");
    await mkdir(config.library.agentsDir, { recursive: true });
    const skills = await loadAndValidateSkills(config.library.skillsDir);
    const agents = await loadAndValidateAgents(
      config.library.agentsDir,
      skills,
    );
    const prior = await runSkillContextAnalysis({
      config,
      skills,
      agents,
      skill: "example",
      subject: "base",
      targets: ["codex"],
      scenarios: [{ name: "full", target: "codex", supportPaths: [] }],
      repositoryRoot: root,
      resultDirectory: results,
    });
    const beforeExpectedHashRejection = (await readdir(results)).sort();
    await expect(
      runSkillContextAnalysis({
        config,
        skills,
        agents,
        skill: "example",
        subject: "candidate",
        targets: ["codex"],
        scenarios: [{ name: "full", target: "codex", supportPaths: [] }],
        repositoryRoot: root,
        resultDirectory: results,
        comparison: {
          path: path.join(root, prior.path),
          expectedPayloadSha256: "0".repeat(64),
        },
      }),
    ).rejects.toThrow("expected hash");
    expect((await readdir(results)).sort()).toEqual(
      beforeExpectedHashRejection,
    );
    const tampered = path.join(results, "duplicate.json");
    await writeFile(
      tampered,
      prior.envelope.bytes
        .toString("utf8")
        .replace(
          '{"payloadSha256":',
          `{\"payloadSha256\":\"${prior.payloadSha256}\",\"payloadSha256\":`,
        ),
      "utf8",
    );
    const before = (await readFile(tampered)).toString("utf8");
    const beforeDuplicateMemberRejection = (await readdir(results)).sort();

    await expect(
      runSkillContextAnalysis({
        config,
        skills,
        agents,
        skill: "example",
        subject: "candidate",
        targets: ["codex"],
        scenarios: [{ name: "full", target: "codex", supportPaths: [] }],
        repositoryRoot: root,
        resultDirectory: results,
        comparison: {
          path: tampered,
          expectedPayloadSha256: prior.payloadSha256,
        },
      }),
    ).rejects.toThrow("comparison");
    expect((await readdir(results)).sort()).toEqual(
      beforeDuplicateMemberRejection,
    );
    expect(
      (await readFile(path.join(root, prior.path))).equals(
        prior.envelope.bytes,
      ),
    ).toBe(true);
    expect(await readFile(tampered, "utf8")).toBe(before);
  });

  it("accepts zero and partial scenario declarations without adding undeclared support records", async () => {
    const root = await createTempDir();
    temporary.push(root);
    await run("git", ["init", "-q", root]);
    await writeFile(path.join(root, ".gitignore"), ".ephemeral/\n", "utf8");
    const results = path.join(root, ".ephemeral", "analysis");
    await mkdir(results, { recursive: true });
    const config = makeResolvedConfig(root);
    await createSkillFixture(config.library.skillsDir, "example");
    await mkdir(config.library.agentsDir, { recursive: true });
    const skills = await loadAndValidateSkills(config.library.skillsDir);
    const agents = await loadAndValidateAgents(
      config.library.agentsDir,
      skills,
    );

    const zero = await runSkillContextAnalysis({
      config,
      skills,
      agents,
      skill: "example",
      subject: "candidate",
      targets: ["claude"],
      scenarios: [],
      repositoryRoot: root,
      resultDirectory: results,
    });
    const partial = await runSkillContextAnalysis({
      config,
      skills,
      agents,
      skill: "example",
      subject: "base",
      targets: ["claude", "codex"],
      scenarios: [{ name: "codex-only", target: "codex", supportPaths: [] }],
      repositoryRoot: root,
      resultDirectory: results,
    });

    expect(
      zero.envelope.payload.records.filter(
        (record) => record.kind === "declared-scenario",
      ),
    ).toHaveLength(0);
    expect(
      partial.envelope.payload.records.filter(
        (record) => record.kind === "declared-scenario",
      ),
    ).toHaveLength(1);
  });

  it("rejects an unknown request member before rendering or publishing", async () => {
    const root = await createTempDir();
    temporary.push(root);
    await run("git", ["init", "-q", root]);
    await writeFile(path.join(root, ".gitignore"), ".ephemeral/\n", "utf8");
    const results = path.join(root, ".ephemeral", "analysis");
    await mkdir(results, { recursive: true });
    const config = makeResolvedConfig(root);
    await createSkillFixture(config.library.skillsDir, "example");
    await mkdir(config.library.agentsDir, { recursive: true });
    await mkdir(config.library.generatedDir, { recursive: true });
    const generatedSentinel = path.join(
      config.library.generatedDir,
      "keep.txt",
    );
    await writeFile(generatedSentinel, "unchanged", "utf8");
    const skills = await loadAndValidateSkills(config.library.skillsDir);
    const agents = await loadAndValidateAgents(
      config.library.agentsDir,
      skills,
    );

    await expect(
      runSkillContextAnalysis({
        config,
        skills,
        agents,
        skill: "example",
        subject: "candidate",
        targets: ["codex"],
        scenarios: [],
        repositoryRoot: root,
        resultDirectory: results,
        unexpected: true,
      } as never),
    ).rejects.toThrow("unknown member");
    await expect(readFile(generatedSentinel, "utf8")).resolves.toBe(
      "unchanged",
    );
  });

  it("categorizes malformed validated-array members as request failures", async () => {
    const root = await createTempDir();
    temporary.push(root);
    const config = makeResolvedConfig(root);
    for (const member of [null, 1, "skill"]) {
      await expect(
        runSkillContextAnalysis({
          config,
          skills: [member] as never,
          agents: [],
          skill: "example",
          subject: "candidate",
          targets: ["codex"],
          scenarios: [],
          repositoryRoot: root,
          resultDirectory: path.join(root, ".ephemeral", "analysis"),
        }),
      ).rejects.toMatchObject({ category: "request" });
      await expect(
        runSkillContextAnalysis({
          config,
          skills: [],
          agents: [member] as never,
          skill: "example",
          subject: "candidate",
          targets: ["codex"],
          scenarios: [],
          repositoryRoot: root,
          resultDirectory: path.join(root, ".ephemeral", "analysis"),
        }),
      ).rejects.toMatchObject({ category: "request" });
    }
  });

  it("refuses nonignored and outside result directories before publication", async () => {
    const root = await createTempDir();
    temporary.push(root);
    await run("git", ["init", "-q", root]);
    const config = makeResolvedConfig(root);
    await createSkillFixture(config.library.skillsDir, "example");
    await mkdir(config.library.agentsDir, { recursive: true });
    await mkdir(path.join(root, ".ephemeral", "analysis"), {
      recursive: true,
    });
    const skills = await loadAndValidateSkills(config.library.skillsDir);
    const agents = await loadAndValidateAgents(
      config.library.agentsDir,
      skills,
    );
    const request = {
      config,
      skills,
      agents,
      skill: "example",
      subject: "candidate" as const,
      targets: ["codex"] as const,
      scenarios: [],
      repositoryRoot: root,
    };
    await expect(
      runSkillContextAnalysis({
        ...request,
        resultDirectory: path.join(root, ".ephemeral", "analysis"),
      }),
    ).rejects.toThrow("ignored");
    await expect(
      runSkillContextAnalysis({
        ...request,
        resultDirectory: path.join(root, "outside"),
      }),
    ).rejects.toMatchObject({ category: "request" });
  });

  it("refuses a wrong-kind deterministic destination without replacing it", async () => {
    const root = await createTempDir();
    temporary.push(root);
    await run("git", ["init", "-q", root]);
    await writeFile(path.join(root, ".gitignore"), ".ephemeral/\n", "utf8");
    const results = path.join(root, ".ephemeral", "analysis");
    await mkdir(results, { recursive: true });
    const config = makeResolvedConfig(root);
    await createSkillFixture(config.library.skillsDir, "example");
    await mkdir(config.library.agentsDir, { recursive: true });
    const skills = await loadAndValidateSkills(config.library.skillsDir);
    const agents = await loadAndValidateAgents(
      config.library.agentsDir,
      skills,
    );
    const request = {
      config,
      skills,
      agents,
      skill: "example",
      subject: "candidate" as const,
      targets: ["codex"] as const,
      scenarios: [],
      repositoryRoot: root,
      resultDirectory: results,
    };
    const first = await runSkillContextAnalysis(request);
    const destination = path.join(root, first.path);
    await rm(destination);
    await mkdir(destination);

    await expect(runSkillContextAnalysis(request)).rejects.toThrow(
      "destination",
    );
    await expect(readFile(destination)).rejects.toThrow();
  });

  it("uses a deep immutable snapshot across the first await and projects only invocation controls", async () => {
    const root = await createTempDir();
    temporary.push(root);
    await run("git", ["init", "-q", root]);
    await writeFile(path.join(root, ".gitignore"), ".ephemeral/\n", "utf8");
    const results = path.join(root, ".ephemeral", "analysis");
    await mkdir(results, { recursive: true });
    const config = makeResolvedConfig(root);
    await createSkillFixture(
      config.library.skillsDir,
      "example",
      [
        "---",
        "name: example",
        "description: Original description.",
        "allowed-tools: Bash",
        "codex:",
        "  license: MIT",
        "  metadata:",
        "    ignored: yes",
        "codex_sidecar:",
        "  interface:",
        "    default_prompt: Original prompt",
        "  policy:",
        "    allow_implicit_invocation: true",
        "  dependencies:",
        "    tools: [web]",
        "---",
        "",
        "# Original",
      ].join("\n"),
    );
    await mkdir(config.library.agentsDir, { recursive: true });
    const skills = await loadAndValidateSkills(config.library.skillsDir);
    const agents = await loadAndValidateAgents(
      config.library.agentsDir,
      skills,
    );
    const request = {
      config,
      skills,
      agents,
      skill: "example",
      subject: "candidate" as const,
      targets: ["codex"] as const,
      scenarios: [],
      repositoryRoot: root,
      resultDirectory: results,
    };
    const pending = runSkillContextAnalysis(request);
    queueMicrotask(() => {
      (request as { subject: "base" | "candidate" }).subject = "base";
      skills[0].skillMdContent = "mutated";
      skills[0].source.description = "Mutated description.";
      config.targets.codex.skillDisplayNameSuffix = "Mutated";
    });
    const result = await pending;
    const raw = result.envelope.payload.records.find(
      (record) => record.kind === "raw-source",
    );
    const discovery = result.envelope.payload.records.find(
      (record) => record.kind === "discovery-field",
    );

    expect(result.envelope.payload.subject).toBe("candidate");
    expect(raw).toMatchObject({
      exactText: expect.stringContaining("Original"),
    });
    expect(discovery).toMatchObject({
      invocationControls: [
        'allowed-tools:"Bash"',
        'codex_sidecar.dependencies:{"tools":["web"]}',
        'codex_sidecar.interface.default_prompt:"Original prompt"',
        'codex_sidecar.policy:{"allow_implicit_invocation":true}',
      ],
    });
    expect(JSON.stringify(discovery)).not.toContain("MIT");
    expect(JSON.stringify(discovery)).not.toContain("ignored");
  });

  it("refuses a symlinked selected result directory", async () => {
    const root = await createTempDir();
    temporary.push(root);
    await run("git", ["init", "-q", root]);
    await writeFile(path.join(root, ".gitignore"), ".ephemeral/\n", "utf8");
    await mkdir(path.join(root, ".ephemeral"));
    await mkdir(path.join(root, "elsewhere"));
    await symlink(
      path.join(root, "elsewhere"),
      path.join(root, ".ephemeral", "analysis"),
    );
    const config = makeResolvedConfig(root);
    await createSkillFixture(config.library.skillsDir, "example");
    await mkdir(config.library.agentsDir, { recursive: true });
    const skills = await loadAndValidateSkills(config.library.skillsDir);
    const agents = await loadAndValidateAgents(
      config.library.agentsDir,
      skills,
    );

    await expect(
      runSkillContextAnalysis({
        config,
        skills,
        agents,
        skill: "example",
        subject: "candidate",
        targets: ["codex"],
        scenarios: [{ name: "full", target: "codex", supportPaths: [] }],
        repositoryRoot: root,
        resultDirectory: path.join(root, ".ephemeral", "analysis"),
      }),
    ).rejects.toThrow("symlink");
  });
});
