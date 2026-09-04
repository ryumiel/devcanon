import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { measureSkillPrompt } from "../utils/token-count.js";
import {
  ANALYSIS_PAYLOAD_SCHEMA,
  type AnalysisIdentities,
  type DiscoveryFieldRecord,
  type ExactTextRecord,
  type RawSourceRecord,
  type RenderedSkillRecord,
  SCENARIO_AGGREGATION_ID,
  type SupportFileRecord,
  canonicalizeSkillContext,
  compareSkillContextEnvelopes,
  createDiscoveryFieldRecord,
  createExactTextRecord,
  createScenarioRecord,
} from "./skill-context.js";

const identities: AnalysisIdentities = {
  rendererSemantic: "devcanon-renderer/v1",
  renderConfigSha256: "a".repeat(64),
  analyzerSemantic: "devcanon-analysis/skill-context/v1",
  measureSkillPromptSemantic: "devcanon-measure-skill-prompt/v1",
  tokenizer: "o200k_base",
  exactInputSerialization: "devcanon-exact-input/v1",
  scenarioAggregation: SCENARIO_AGGREGATION_ID,
};

async function exactRecords(subject: "base" | "candidate") {
  const raw = await createExactTextRecord({
    kind: "raw-source",
    subject,
    skill: "skill-a",
    text: "---\nname: skill-a\ndescription: A useful skill\n---\nBody\n",
  });
  const rendered = await createExactTextRecord({
    kind: "rendered-skill",
    subject,
    skill: "skill-a",
    target: "codex",
    text: "# Skill A\n\nBody\n",
  });
  const discovery = await createDiscoveryFieldRecord({
    subject,
    skill: "skill-a",
    target: "codex",
    name: "skill-a",
    description: "A useful skill",
    invocationControls: ["argument-hint: topic"],
  });
  const support = await createExactTextRecord({
    kind: "support-file",
    subject,
    skill: "skill-a",
    target: "codex",
    path: "references/guide.md",
    rawBytesSha256: sha256("guide source bytes"),
    text: "Guide body\n",
  });
  return {
    raw: raw as RawSourceRecord,
    rendered: rendered as RenderedSkillRecord,
    discovery: discovery as DiscoveryFieldRecord,
    support: support as SupportFileRecord,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

describe("skill context analysis contracts", () => {
  it("measures each exact-text family with the unchanged token owner", async () => {
    const records = await exactRecords("base");
    for (const record of Object.values(records)) {
      const metrics = await measureSkillPrompt(record.exactText);
      expect(record.estimatedTokens).toBe(metrics.estimatedTokens);
      expect(record.tokenizer).toBe("o200k_base");
      expect(record.exactInputSha256).toBe(sha256(record.exactText));
    }
    expect(records.raw.target).toBeUndefined();
    expect(records.rendered.target).toBe("codex");
    expect(records.support.path).toBe("references/guide.md");
    expect(records.support.targetTextSha256).toBe(
      sha256(records.support.exactText),
    );
  });

  it("serializes discovery text without invocation controls", async () => {
    const record = await createDiscoveryFieldRecord({
      subject: "base",
      skill: "skill-a",
      target: "claude",
      name: "skill-a",
      description: "A useful skill",
      invocationControls: ["argument-hint: topic", "disable-model-invocation"],
    });

    expect(record.exactText).toBe(
      '{"name":"skill-a","description":"A useful skill"}',
    );
    expect(record.invocationControls).toEqual([
      "argument-hint: topic",
      "disable-model-invocation",
    ]);
    expect(record.key).toContain("claude");
  });

  it("rejects invalid exact-text records before producing a metric", async () => {
    await expect(
      createExactTextRecord({
        kind: "rendered-skill",
        subject: "base",
        skill: "skill-a",
        text: "rendered",
      }),
    ).rejects.toThrow("target");
    await expect(
      createExactTextRecord({
        kind: "raw-source",
        subject: "base",
        skill: "skill-a",
        target: "codex",
        text: "raw",
      }),
    ).rejects.toThrow("raw-source");
  });

  it("aggregates only one matching rendered record and unique support paths", async () => {
    const { rendered, support } = await exactRecords("base");
    const scenario = createScenarioRecord({
      name: "full-context",
      subject: "base",
      skill: "skill-a",
      target: "codex",
      components: [support, rendered],
    });

    expect(scenario.aggregation).toBe("sum-of-components");
    expect(scenario.componentEstimatedTokensTotal).toBe(
      rendered.estimatedTokens + support.estimatedTokens,
    );
    expect("estimatedTokens" in scenario).toBe(false);

    expect(() =>
      createScenarioRecord({
        name: "missing-rendered",
        subject: "base",
        skill: "skill-a",
        target: "codex",
        components: [support],
      }),
    ).toThrow("requires exactly one rendered-skill");
    expect(() =>
      createScenarioRecord({
        name: "duplicate-rendered",
        subject: "base",
        skill: "skill-a",
        target: "codex",
        components: [rendered, rendered],
      }),
    ).toThrow("duplicate scenario component key");
    await expectScenarioFailure(support);
    const candidateRendered = (await exactRecords("candidate")).rendered;
    await expectScenarioFailure(candidateRendered);
  });

  it("rejects unsafe component totals before arithmetic", async () => {
    const { rendered } = await exactRecords("base");
    expect(() =>
      createScenarioRecord({
        name: "unsafe",
        subject: "base",
        skill: "skill-a",
        target: "codex",
        components: [
          { ...rendered, estimatedTokens: Number.MAX_SAFE_INTEGER + 1 },
        ],
      }),
    ).toThrow("safe");
  });

  it("canonicalizes byte-identical envelopes independent of declaration order", async () => {
    const { raw, rendered, discovery, support } = await exactRecords("base");
    const scenario = createScenarioRecord({
      name: "full-context",
      subject: "base",
      skill: "skill-a",
      target: "codex",
      components: [rendered, support],
    });
    const first = canonicalizeSkillContext({
      subject: "base",
      skill: "skill-a",
      targets: ["codex"],
      identities,
      records: [raw, rendered, discovery, support, scenario],
    });
    const second = canonicalizeSkillContext({
      subject: "base",
      skill: "skill-a",
      targets: ["codex"],
      identities: { ...identities },
      records: [scenario, support, discovery, raw, rendered],
    });

    expect(first.payload.schema).toBe(ANALYSIS_PAYLOAD_SCHEMA);
    expect(first.bytes.equals(second.bytes)).toBe(true);
    expect(first.payloadSha256).toBe(second.payloadSha256);
    expect(first.bytes.toString("utf8").endsWith("\n")).toBe(true);
  });

  it("rejects mismatched identities and validates envelope self-hashes before comparison", async () => {
    const base = await canonicalEnvelope("base", 4);
    const candidate = await canonicalEnvelope("candidate", 2);
    const changedIdentity = canonicalizeSkillContext({
      subject: "candidate",
      skill: candidate.payload.skill,
      targets: candidate.payload.targets,
      identities: {
        ...candidate.payload.identities,
        analyzerSemantic: "other",
      },
      records: candidate.payload.records,
    });

    expect(() => compareSkillContextEnvelopes(base, changedIdentity)).toThrow(
      "identity",
    );
    const hashMismatch = Object.defineProperty(
      { ...candidate, payloadSha256: "b".repeat(64) },
      "bytes",
      { value: candidate.bytes, enumerable: false },
    ) as typeof candidate;
    expect(() => compareSkillContextEnvelopes(base, hashMismatch)).toThrow(
      "hash",
    );
  });

  it("reports exact positive, negative, and zero-base comparison arithmetic", async () => {
    const positive = compareSkillContextEnvelopes(
      await canonicalEnvelope("base", 4),
      await canonicalEnvelope("candidate", 2),
    ).metrics[0];
    expect(positive).toMatchObject({
      estimatedTokensDelta: -2,
      reductionNumerator: 2,
      reductionDenominator: 4,
      reduction: true,
      reductionRatio: { numerator: 2, denominator: 4 },
    });

    const negative = compareSkillContextEnvelopes(
      await canonicalEnvelope("base", 2),
      await canonicalEnvelope("candidate", 4),
    ).metrics[0];
    expect(negative).toMatchObject({
      estimatedTokensDelta: 2,
      reductionNumerator: -2,
      reductionDenominator: 2,
      reduction: false,
    });

    const zero = compareSkillContextEnvelopes(
      await canonicalEnvelope("base", 0),
      await canonicalEnvelope("candidate", 1),
    ).metrics[0];
    expect(zero).toMatchObject({
      estimatedTokensDelta: 1,
      reductionNumerator: -1,
      reductionDenominator: 0,
      reduction: false,
    });
    expect(zero.reductionRatio).toBeUndefined();
  });
});

async function expectScenarioFailure(
  component: ExactTextRecord,
): Promise<void> {
  const { rendered, support } = await exactRecords("base");
  expect(() =>
    createScenarioRecord({
      name: "full-context",
      subject: "base",
      skill: "skill-a",
      target: "codex",
      components: [rendered, support, component],
    }),
  ).toThrow(/duplicate|subject/);
}

async function canonicalEnvelope(
  subject: "base" | "candidate",
  estimatedTokens: number,
) {
  const record = await createExactTextRecord({
    kind: "raw-source",
    subject,
    skill: "skill-a",
    text: "source",
  });
  return canonicalizeSkillContext({
    subject,
    skill: "skill-a",
    targets: [],
    identities,
    records: [{ ...record, estimatedTokens }],
  });
}
