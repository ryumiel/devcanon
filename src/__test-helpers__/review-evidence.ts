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
