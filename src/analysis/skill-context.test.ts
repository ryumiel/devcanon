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
  parseCanonicalSkillContextEnvelope,
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
    const first = await canonicalizeSkillContext({
      subject: "base",
      skill: "skill-a",
      targets: ["codex"],
      identities,
      records: [raw, rendered, discovery, support, scenario],
    });
    const second = await canonicalizeSkillContext({
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

  it("rejects tampered counts, mismatched identities, and self-hash changes", async () => {
    const base = await completeEnvelope("base");
    const candidate = await completeEnvelope("candidate");
    await expect(
      canonicalizeSkillContext({
        subject: "base",
        skill: base.payload.skill,
        targets: base.payload.targets,
        identities: base.payload.identities,
        records: base.payload.records.map((record) =>
          record.kind === "raw-source"
            ? { ...record, estimatedTokens: record.estimatedTokens + 1 }
            : record,
        ),
      }),
    ).rejects.toThrow("measurement mismatch");
    const changedIdentity = await canonicalizeSkillContext({
      subject: "candidate",
      skill: candidate.payload.skill,
      targets: candidate.payload.targets,
      identities: {
        ...candidate.payload.identities,
        analyzerSemantic: "other",
      },
      records: candidate.payload.records,
    });

    await expect(
      compareSkillContextEnvelopes(base, changedIdentity),
    ).rejects.toThrow("identity");
    const hashMismatch = Object.defineProperty(
      { ...candidate, payloadSha256: "b".repeat(64) },
      "bytes",
      { value: candidate.bytes, enumerable: false },
    ) as typeof candidate;
    await expect(
      compareSkillContextEnvelopes(base, hashMismatch),
    ).rejects.toThrow("hash");
  });

  it("reports exact positive, negative, and genuine zero-base comparison arithmetic", async () => {
    const reducedBase = await completeEnvelope("base", {
      supportText: "many tokens ".repeat(20),
    });
    const reducedCandidate = await completeEnvelope("candidate", {
      supportText: "one",
    });
    const reduced = supportMetric(
      await compareSkillContextEnvelopes(reducedBase, reducedCandidate),
    );
    expect(reduced.estimatedTokensDelta).toBeLessThan(0);
    expect(reduced.reductionNumerator).toBeGreaterThan(0);
    expect(reduced.reduction).toBe(true);
    expect(reduced.reductionRatio).toEqual({
      numerator: reduced.reductionNumerator,
      denominator: reduced.reductionDenominator,
    });

    const increased = supportMetric(
      await compareSkillContextEnvelopes(
        await completeEnvelope("base", { supportText: "one" }),
        await completeEnvelope("candidate", {
          supportText: "many tokens ".repeat(20),
        }),
      ),
    );
    expect(increased.estimatedTokensDelta).toBeGreaterThan(0);
    expect(increased.reductionNumerator).toBeLessThan(0);
    expect(increased.reduction).toBe(false);

    const zeroBase = await completeEnvelope("base", { supportText: "" });
    const nonzeroCandidate = await completeEnvelope("candidate", {
      supportText: "one",
    });
    const zero = supportMetric(
      await compareSkillContextEnvelopes(zeroBase, nonzeroCandidate),
    );
    expect(zero).toMatchObject({
      reductionDenominator: 0,
      reduction: false,
    });
    expect(zero.reductionRatio).toBeUndefined();
  });

  it("sorts discovery controls, rejects duplicates, and preserves multiline descriptions", async () => {
    const first = await createDiscoveryFieldRecord({
      subject: "base",
      skill: "skill-a",
      target: "codex",
      name: "skill-a",
      description: "first line\nsecond line",
      invocationControls: ["z-control", "a-control"],
    });
    const second = await createDiscoveryFieldRecord({
      subject: "base",
      skill: "skill-a",
      target: "codex",
      name: "skill-a",
      description: "first line\nsecond line",
      invocationControls: ["a-control", "z-control"],
    });
    expect(first.invocationControls).toEqual(["a-control", "z-control"]);
    expect(first).toEqual(second);
    await expect(
      createDiscoveryFieldRecord({
        subject: "base",
        skill: "skill-a",
        target: "codex",
        name: "skill-a",
        description: "valid",
        invocationControls: ["same", "same"],
      }),
    ).rejects.toThrow("duplicate invocation control");
    const envelope = await completeEnvelope("base");
    await expect(
      canonicalizeSkillContext({
        subject: "base",
        skill: "skill-a",
        targets: ["codex"],
        identities,
        records: envelope.payload.records.map((record) =>
          record.kind === "discovery-field"
            ? { ...record, invocationControls: ["z-control", "a-control"] }
            : record,
        ),
      }),
    ).rejects.toThrow("noncanonical invocation control order");
  });

  it("rejects malformed Unicode before exact-text hashing and measurement", async () => {
    await expect(
      createExactTextRecord({
        kind: "raw-source",
        subject: "base",
        skill: "skill-a",
        text: "bad\ud800",
      }),
    ).rejects.toThrow("well-formed Unicode");
    await expect(
      createDiscoveryFieldRecord({
        subject: "base",
        skill: "skill-a",
        target: "codex",
        name: "skill-a",
        description: "bad\udc00",
        invocationControls: [],
      }),
    ).rejects.toThrow("well-formed Unicode");
  });

  it("rejects independent scenario mismatch families before aggregation", async () => {
    const { rendered, support, discovery } = await exactRecords("base");
    const foreignTarget = await createExactTextRecord({
      kind: "support-file",
      subject: "base",
      skill: "skill-a",
      target: "claude",
      path: "references/other.md",
      rawBytesSha256: sha256("other"),
      text: "other",
    });
    const foreignSkill = await createExactTextRecord({
      kind: "support-file",
      subject: "base",
      skill: "skill-b",
      target: "codex",
      path: "references/other.md",
      rawBytesSha256: sha256("other"),
      text: "other",
    });
    const overflowingSupport = {
      ...support,
      estimatedTokens: Number.MAX_SAFE_INTEGER,
    };
    const overflowingRendered = { ...rendered, estimatedTokens: 1 };
    for (const [component, error] of [
      [foreignTarget, "target mismatch"],
      [foreignSkill, "skill mismatch"],
      [discovery, "rendered-skill or support-file"],
    ] as const) {
      expect(() =>
        createScenarioRecord({
          name: "invalid",
          subject: "base",
          skill: "skill-a",
          target: "codex",
          components: [rendered, component],
        }),
      ).toThrow(error);
    }
    expect(() =>
      createScenarioRecord({
        name: "overflow",
        subject: "base",
        skill: "skill-a",
        target: "codex",
        components: [overflowingRendered, overflowingSupport],
      }),
    ).toThrow("overflow");
  });

  it("rejects duplicate payload identities and validates canonical parse round-trips", async () => {
    const envelope = await completeEnvelope("base");
    await expect(
      canonicalizeSkillContext({
        subject: "base",
        skill: "skill-a",
        targets: ["codex"],
        identities,
        records: [...envelope.payload.records, envelope.payload.records[0]],
      }),
    ).rejects.toThrow("duplicate record key");
    const parsed = await parseCanonicalSkillContextEnvelope(envelope.bytes);
    expect(parsed.bytes.equals(envelope.bytes)).toBe(true);
    await expect(
      parseCanonicalSkillContextEnvelope(Buffer.from("{bad\n", "utf8")),
    ).rejects.toThrow("JSON");
    await expect(
      parseCanonicalSkillContextEnvelope(
        Buffer.from(
          envelope.bytes.toString("utf8").replace(/\n$/u, ""),
          "utf8",
        ),
      ),
    ).rejects.toThrow("noncanonical");
  });

  it("rejects comparison role, record-set, and scenario-composition mismatches", async () => {
    const base = await completeEnvelope("base");
    await expect(
      compareSkillContextEnvelopes(base, await completeEnvelope("base")),
    ).rejects.toThrow("one base and one candidate");
    await expect(
      compareSkillContextEnvelopes(
        base,
        await completeEnvelope("candidate", { scenarioName: "other" }),
      ),
    ).rejects.toThrow("record-set mismatch");
    await expect(
      compareSkillContextEnvelopes(
        base,
        await completeEnvelope("candidate", {
          includeSupportInScenario: false,
        }),
      ),
    ).rejects.toThrow("scenario composition mismatch");
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

async function completeEnvelope(
  subject: "base" | "candidate",
  options: {
    readonly supportText?: string;
    readonly scenarioName?: string;
    readonly includeSupportInScenario?: boolean;
  } = {},
) {
  const raw = await createExactTextRecord({
    kind: "raw-source",
    subject,
    skill: "skill-a",
    text: "source",
  });
  const rendered = await createExactTextRecord({
    kind: "rendered-skill",
    subject,
    skill: "skill-a",
    target: "codex",
    text: "rendered skill",
  });
  const discovery = await createDiscoveryFieldRecord({
    subject,
    skill: "skill-a",
    target: "codex",
    name: "skill-a",
    description: "A useful\nmultiline description",
    invocationControls: ["argument-hint: topic"],
  });
  const support = (await createExactTextRecord({
    kind: "support-file",
    subject,
    skill: "skill-a",
    target: "codex",
    path: "references/guide.md",
    rawBytesSha256: sha256("guide source bytes"),
    text: options.supportText ?? "support text",
  })) as SupportFileRecord;
  const scenario = createScenarioRecord({
    name: options.scenarioName ?? "full-context",
    subject,
    skill: "skill-a",
    target: "codex",
    components:
      options.includeSupportInScenario === false
        ? [rendered as RenderedSkillRecord]
        : [rendered as RenderedSkillRecord, support],
  });
  return await canonicalizeSkillContext({
    subject,
    skill: "skill-a",
    targets: ["codex"],
    identities,
    records: [raw, rendered, discovery, support, scenario],
  });
}

function supportMetric(
  comparison: Awaited<ReturnType<typeof compareSkillContextEnvelopes>>,
) {
  return comparison.metrics.find((metric) =>
    metric.recordKey.startsWith("support-file:"),
  ) as (typeof comparison.metrics)[number];
}
