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
    ).toThrow("duplicate rendered-skill scenario component");
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
    assertComparisonFormula(reduced, reducedBase, reducedCandidate);
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
    assertComparisonFormula(
      increased,
      await completeEnvelope("base", { supportText: "one" }),
      await completeEnvelope("candidate", {
        supportText: "many tokens ".repeat(20),
      }),
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
    assertComparisonFormula(zero, zeroBase, nonzeroCandidate);
    expect(zero).toMatchObject({
      reductionDenominator: 0,
      reduction: false,
    });
    expect(zero.reductionRatio).toBeUndefined();

    const equalBase = await completeEnvelope("base", { supportText: "equal" });
    const equalCandidate = await completeEnvelope("candidate", {
      supportText: "equal",
    });
    const equal = supportMetric(
      await compareSkillContextEnvelopes(equalBase, equalCandidate),
    );
    assertComparisonFormula(equal, equalBase, equalCandidate);
    expect(equal).toMatchObject({
      estimatedTokensDelta: 0,
      reductionNumerator: 0,
      reduction: false,
    });
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
    await expect(
      createDiscoveryFieldRecord({
        subject: "base",
        skill: "skill-a",
        target: "codex",
        name: "skill-a",
        description: "valid",
        invocationControls: "not-an-array" as unknown as readonly string[],
      }),
    ).rejects.toThrow("invocation controls must be an array");
    await expect(
      createDiscoveryFieldRecord({
        subject: "base",
        skill: "skill-a",
        target: "codex",
        name: "skill-a",
        description: "valid",
        invocationControls: { invalid: true } as unknown as readonly string[],
      }),
    ).rejects.toThrow("invocation controls must be an array");
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
    const { raw, rendered, support, discovery } = await exactRecords("base");
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
        components: [rendered, overflowingSupport],
      }),
    ).toThrow("overflow");
    expect(() =>
      createScenarioRecord({
        name: "raw-forbidden",
        subject: "base",
        skill: "skill-a",
        target: "codex",
        components: [rendered, raw],
      }),
    ).toThrow("rendered-skill or support-file");
  });

  it("independently blocks every comparison identity mismatch", async () => {
    const base = await completeEnvelope("base");
    const cases = [
      ["rendererSemantic", "other-renderer", "comparison identity mismatch"],
      ["renderConfigSha256", "b".repeat(64), "comparison identity mismatch"],
      ["analyzerSemantic", "other-analyzer", "comparison identity mismatch"],
      [
        "measureSkillPromptSemantic",
        "other-token-primitive",
        "comparison identity mismatch",
      ],
      ["tokenizer", "other-tokenizer", "unsupported tokenizer identity"],
      [
        "exactInputSerialization",
        "other-input-serialization",
        "comparison identity mismatch",
      ],
      [
        "scenarioAggregation",
        "other-aggregation",
        "unknown scenario aggregation identity",
      ],
    ] as const;

    for (const [field, value, error] of cases) {
      const candidate = retagIdentity(
        await completeEnvelope("candidate"),
        field,
        value,
      );
      await expect(
        compareSkillContextEnvelopes(base, candidate),
      ).rejects.toThrow(error);
    }
  });

  it("rejects kind-specific scenario duplicates before generic component identity", async () => {
    const { rendered, support } = await exactRecords("base");
    expect(() =>
      createScenarioRecord({
        name: "duplicate-rendered",
        subject: "base",
        skill: "skill-a",
        target: "codex",
        components: [rendered, rendered],
      }),
    ).toThrow("duplicate rendered-skill scenario component");
    expect(() =>
      createScenarioRecord({
        name: "duplicate-support",
        subject: "base",
        skill: "skill-a",
        target: "codex",
        components: [rendered, support, support],
      }),
    ).toThrow("duplicate normalized support path");
  });

  it("rejects a single-fault scenario subject mismatch with a unique support path", async () => {
    const { rendered } = await exactRecords("base");
    const candidateSupport = await createExactTextRecord({
      kind: "support-file",
      subject: "candidate",
      skill: "skill-a",
      target: "codex",
      path: "references/candidate.md",
      rawBytesSha256: sha256("candidate support"),
      text: "candidate support",
    });
    expect(() =>
      createScenarioRecord({
        name: "subject-mismatch",
        subject: "base",
        skill: "skill-a",
        target: "codex",
        components: [rendered, candidateSupport],
      }),
    ).toThrow("scenario component subject mismatch");
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

  it("uses strict wire schemas before canonical and integrity validation", async () => {
    const envelope = await completeEnvelope("base");
    const cases = [
      (wire: MutableEnvelopeWire) => {
        wire.unknown = true;
      },
      (wire: MutableEnvelopeWire) => {
        Reflect.deleteProperty(wire.payload, "skill");
      },
      (wire: MutableEnvelopeWire) => {
        wire.payload.identities.rendererSemantic = 42;
      },
      (wire: MutableEnvelopeWire) => {
        const raw = wire.payload.records.find(
          (record) => record.kind === "raw-source",
        );
        if (raw !== undefined) raw.target = "codex";
      },
    ];

    for (const mutate of cases) {
      await expect(
        parseCanonicalSkillContextEnvelope(mutateEnvelope(envelope, mutate)),
      ).rejects.toThrow("invalid envelope structure");
    }

    await expect(
      parseCanonicalSkillContextEnvelope(Buffer.from("[]\n", "utf8")),
    ).rejects.toThrow("envelope must be an object");
  });

  it("rejects a comparison envelope that inherits its root wire fields", async () => {
    const base = await completeEnvelope("base");
    const candidate = await completeEnvelope("candidate");
    const inheritedEnvelope = Object.create(candidate) as typeof candidate;

    await expect(
      compareSkillContextEnvelopes(base, inheritedEnvelope),
    ).rejects.toThrow("invalid envelope structure");
  });

  it("rejects inherited required fields at every nested wire-object node", async () => {
    const base = await completeEnvelope("base");
    const candidate = await completeEnvelope("candidate");
    const nestedCases = [
      {
        node: "payload",
        replace: () =>
          bindEnvelopeBytes(candidate, Object.create(candidate.payload)),
      },
      {
        node: "identities",
        replace: () =>
          bindEnvelopeBytes(candidate, {
            ...candidate.payload,
            identities: Object.create(candidate.payload.identities),
          }),
      },
      ...[
        "raw-source",
        "rendered-skill",
        "discovery-field",
        "support-file",
        "declared-scenario",
      ].map((kind) => ({
        node: kind,
        replace: () =>
          bindEnvelopeBytes(candidate, {
            ...candidate.payload,
            records: candidate.payload.records.map((record) =>
              record.kind === kind ? Object.create(record) : record,
            ),
          }),
      })),
    ];

    for (const { node, replace } of nestedCases) {
      await expect(
        compareSkillContextEnvelopes(base, replace()),
        `wire node: ${node}`,
      ).rejects.toThrow("invalid envelope structure");
    }
  });

  it("rejects a non-plain wire object even when all required fields are own", async () => {
    const base = await completeEnvelope("base");
    const candidate = await completeEnvelope("candidate");
    const nonPlainIdentities = Object.assign(
      Object.create({}),
      candidate.payload.identities,
    );
    const nonPlainCandidate = bindEnvelopeBytes(candidate, {
      ...candidate.payload,
      identities: nonPlainIdentities,
    });

    await expect(
      compareSkillContextEnvelopes(base, nonPlainCandidate),
    ).rejects.toThrow("invalid envelope structure");
  });

  it("compares valid JSON-parsed canonical envelopes", async () => {
    const base = await completeEnvelope("base");
    const candidate = await completeEnvelope("candidate");
    const parsedBase = await parseCanonicalSkillContextEnvelope(base.bytes);
    const parsedCandidate = await parseCanonicalSkillContextEnvelope(
      candidate.bytes,
    );

    await expect(
      compareSkillContextEnvelopes(parsedBase, parsedCandidate),
    ).resolves.toMatchObject({
      basePayloadSha256: base.payloadSha256,
      candidatePayloadSha256: candidate.payloadSha256,
    });
  });

  it("keeps domain integrity checks after structural wire parsing", async () => {
    const envelope = await completeEnvelope("base");
    const tampered = mutateEnvelope(envelope, (wire) => {
      const support = wire.payload.records.find(
        (record) => record.kind === "support-file",
      );
      if (support !== undefined) support.exactText = "tampered support";
    });

    await expect(parseCanonicalSkillContextEnvelope(tampered)).rejects.toThrow(
      "exact input hash mismatch",
    );
  });

  it("accepts semantically identical scenario fields regardless of property insertion order", async () => {
    const envelope = await completeEnvelope("base");
    const reordered = envelope.payload.records.map((record) => {
      if (record.kind !== "declared-scenario") return record;
      return {
        componentEstimatedTokensTotal: record.componentEstimatedTokensTotal,
        componentKeys: record.componentKeys,
        aggregation: record.aggregation,
        name: record.name,
        target: record.target,
        skill: record.skill,
        subject: record.subject,
        kind: record.kind,
        key: record.key,
        schema: record.schema,
      };
    });
    await expect(
      canonicalizeSkillContext({
        subject: "base",
        skill: "skill-a",
        targets: ["codex"],
        identities,
        records: reordered,
      }),
    ).resolves.toMatchObject({ payloadSha256: envelope.payloadSha256 });
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

function assertComparisonFormula(
  metric: Awaited<
    ReturnType<typeof compareSkillContextEnvelopes>
  >["metrics"][number],
  base: Awaited<ReturnType<typeof completeEnvelope>>,
  candidate: Awaited<ReturnType<typeof completeEnvelope>>,
): void {
  const baseValue = supportRecord(base).estimatedTokens;
  const candidateValue = supportRecord(candidate).estimatedTokens;
  expect(metric.estimatedTokensDelta).toBe(candidateValue - baseValue);
  expect(metric.reductionNumerator).toBe(baseValue - candidateValue);
  expect(metric.reductionDenominator).toBe(baseValue);
}

function supportRecord(envelope: Awaited<ReturnType<typeof completeEnvelope>>) {
  return envelope.payload.records.find(
    (record) => record.kind === "support-file",
  ) as SupportFileRecord;
}

function retagIdentity(
  envelope: Awaited<ReturnType<typeof completeEnvelope>>,
  field: keyof AnalysisIdentities,
  value: string,
) {
  const identities = {
    ...envelope.payload.identities,
    [field]: value,
  } as AnalysisIdentities;
  const payload = { ...envelope.payload, identities };
  const payloadSha256 = sha256(`${JSON.stringify(payload)}\n`);
  const bytes = Buffer.from(
    `${JSON.stringify({ payloadSha256, payload })}\n`,
    "utf8",
  );
  return Object.defineProperty({ payloadSha256, payload }, "bytes", {
    value: bytes,
    enumerable: false,
  }) as typeof envelope;
}

interface MutableEnvelopeWire {
  payloadSha256: string;
  payload: {
    skill?: string;
    identities: Record<string, unknown>;
    records: Array<Record<string, unknown>>;
  };
  unknown?: boolean;
}

function mutateEnvelope(
  envelope: Awaited<ReturnType<typeof completeEnvelope>>,
  mutate: (wire: MutableEnvelopeWire) => void,
): Buffer {
  const wire = JSON.parse(
    envelope.bytes.toString("utf8"),
  ) as MutableEnvelopeWire;
  mutate(wire);
  return Buffer.from(`${JSON.stringify(wire)}\n`, "utf8");
}

function bindEnvelopeBytes(
  envelope: Awaited<ReturnType<typeof completeEnvelope>>,
  payload: unknown,
): Awaited<ReturnType<typeof completeEnvelope>> {
  return Object.defineProperty(
    { payloadSha256: envelope.payloadSha256, payload },
    "bytes",
    {
      value: envelope.bytes,
      enumerable: false,
    },
  ) as Awaited<ReturnType<typeof completeEnvelope>>;
}
