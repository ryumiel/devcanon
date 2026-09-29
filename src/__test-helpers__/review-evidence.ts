/** Build current review evidence from presentation fixtures and a review head. */
export function createReviewEnvelope(value: unknown, headSha: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const envelope = value as Record<string, unknown>;
  if (
    envelope.schema !== "play-review/findings/v3" ||
    "review_head_sha" in envelope
  )
    return value;
  const identities = new Map<string, string>();
  const entries = (items: unknown) =>
    Array.isArray(items)
      ? items.map((item) => {
          if (!item || typeof item !== "object") return item;
          const finding = item as Record<string, unknown>;
          const key = JSON.stringify(finding);
          const id = identities.get(key) ?? `F${identities.size + 1}`;
          identities.set(key, id);
          return {
            ...finding,
            id,
            origin_head_sha: headSha,
            assessment: {
              state: "fresh",
              assessed_head_sha: headSha,
              reuse_checked_head_sha: null,
              basis: "Fixture source, dependency, contract and anchor evidence",
              selection: finding.critic ? "consequential" : "none",
              verification: finding.critic ? "completed" : "not-required",
            },
          };
        })
      : items;
  const findings = entries(envelope.findings);
  const carry = entries(envelope.carry_forward);
  const selected = [
    ...(Array.isArray(findings) ? findings : []),
    ...(Array.isArray(carry) ? carry : []),
  ]
    .filter((finding) => finding?.critic)
    .map((finding) => finding.id);
  return {
    ...envelope,
    schema: "play-review/findings/v3",
    review_head_sha: headSha,
    findings,
    carry_forward: carry,
    prior_dispositions: [],
    verification: {
      state: selected.length ? "completed" : "not-required",
      selected_ids: [...new Set(selected)],
      reason: "Fixture verification selection",
    },
  };
}

/** Valid current baseline; mutate its completed evidence explicitly for rejection cases. */
export function currentReviewEnvelope(
  headSha: string,
  findings: Record<string, unknown>[] = [],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return createReviewEnvelope(
    {
      schema: "play-review/findings/v3",
      findings,
      carry_forward: [],
      incomplete_review_routes: [],
      ...overrides,
    },
    headSha,
  ) as Record<string, unknown>;
}

export function targetedEnvelope(head: string) {
  return {
    schema: "play-review/findings/v3",
    review_head_sha: head,
    findings: [] as Record<string, unknown>[],
    carry_forward: [] as Record<string, unknown>[],
    prior_dispositions: [] as Record<string, unknown>[],
    incomplete_review_routes: [] as Record<string, string>[],
    verification: {
      state: "not-required",
      reason: "No blocking triggers",
      selected_ids: [] as string[],
    },
  };
}
export function targetedFinding(head: string) {
  return {
    id: "F1",
    origin_head_sha: head,
    path: "src/a.ts",
    line: 1,
    start_line: null,
    severity: "Blocking",
    category: "Logic",
    critic: null as string | null,
    anchor: "natural",
    why: "A supported consequence",
    recommendation: "Restore the invariant",
    body: "**Blocking | Logic** — A supported consequence\n\n**Recommendation:** Restore the invariant",
    assessment: {
      state: "fresh",
      assessed_head_sha: head,
      reuse_checked_head_sha: null as string | null,
      basis: "Inspected source, dependencies, contract and anchor",
      selection: "none",
      verification: "not-required",
    },
  };
}

/** Concrete validator scenarios. Each snapshot is complete; rejection cases are never normalized. */
export function targetedEvidenceCases(head: string) {
  const prior = "b".repeat(40);
  const value = targetedEnvelope(head);
  const claim = targetedFinding(head);
  const cases: {
    name: string;
    accepted: boolean;
    value: Record<string, unknown>;
  }[] = [];
  const record = (name: string, accepted: boolean) =>
    cases.push({ name, accepted, value: structuredClone(value) });
  record("empty skipped verification", true);
  value.findings = [claim];
  record("ordinary unselected blocker", true);
  for (const disposition of [
    "FAILED",
    "NEEDS_CONTEXT",
    "CONTROLLER_OBSERVED_FAILURE",
  ]) {
    const failed = targetedEnvelope(head);
    failed.incomplete_review_routes = [{ route: "D7", disposition }];
    cases.push({
      name: `D7 ${disposition} without accepted evidence`,
      accepted: true,
      value: failed,
    });
    for (const field of ["findings", "carry_forward", "prior_dispositions"]) {
      const contradictory = structuredClone(failed);
      if (field === "prior_dispositions")
        contradictory.prior_dispositions = [
          {
            id: "old",
            origin_head_sha: prior,
            assessed_head_sha: head,
            status: "resolved",
            reason: "Assessed resolved",
          },
        ];
      else
        contradictory[field as "findings" | "carry_forward"] = [
          targetedFinding(head),
        ];
      cases.push({
        name: `D7 ${disposition} cannot admit ${field}`,
        accepted: false,
        value: contradictory,
      });
    }
  }

  claim.critic = "VALID";
  record("borrowed verdict", false);
  claim.critic = null;
  claim.assessment.selection = "disputed";
  claim.assessment.verification = "incomplete";
  value.verification = {
    state: "incomplete",
    selected_ids: ["F1"],
    reason: "Verifier unavailable",
  };
  record("required verifier failure missing D10", false);
  value.incomplete_review_routes = [{ route: "D10", disposition: "FAILED" }];
  record("required verifier failure with D10", true);
  const prematureD10 = structuredClone(value);
  prematureD10.incomplete_review_routes.push({
    route: "D7",
    disposition: "FAILED",
  });
  cases.push({
    name: "D7 failure cannot dispatch D10",
    accepted: false,
    value: prematureD10,
  });

  claim.severity = "Nit";
  claim.body = claim.body.replace("**Blocking", "**Nit");
  record("selected nit", false);
  claim.assessment.selection = "none";
  claim.assessment.verification = "not-required";
  value.verification = targetedEnvelope(head).verification;
  value.incomplete_review_routes = [];
  claim.origin_head_sha = prior;
  claim.assessment.state = "reused";
  claim.assessment.assessed_head_sha = prior;
  claim.assessment.reuse_checked_head_sha = head;
  record("nit reused after current evidence check", true);
  claim.assessment.reuse_checked_head_sha = prior;
  record("nit reuse check is stale", false);
  value.findings = [targetedFinding(head)];
  value.carry_forward = [targetedFinding(head)];
  record("exact current and carried mirror", true);
  value.carry_forward[0].why = "Different claim";
  value.carry_forward[0].body = targetedFinding(head).body.replace(
    "A supported consequence",
    "Different claim",
  );
  record("conflicting mirror", false);
  value.carry_forward = [];
  value.findings.push(targetedFinding(head));
  record("duplicate current identity", false);
  value.findings = [targetedFinding(head)];
  value.prior_dispositions = [
    {
      id: "prior-1",
      origin_head_sha: prior,
      assessed_head_sha: head,
      status: "resolved",
      reason: "Current source disproves claim",
    },
  ];
  record("resolved independent prior claim", true);
  value.prior_dispositions[0].id = "F1";
  record("resolved prior contradicts unresolved claim", false);
  for (const id of ["F1 ", "Ｆ1", "F1\n"]) {
    value.prior_dispositions[0].id = id;
    record(`invalid prior identity ${JSON.stringify(id)}`, false);
  }
  value.prior_dispositions = [];
  value.findings[0].id = "F1\n";
  record("newline finding identity", false);
  value.findings = [targetedFinding(head)];
  (value.findings[0].assessment as Record<string, unknown>).assessed_head_sha =
    prior;
  record("fresh assessment has prior head", false);
  value.findings = [];
  const { verification: _verification, ...missing } = structuredClone(value);
  cases.push({
    name: "missing verifier evidence",
    accepted: false,
    value: missing,
  });
  return cases;
}
