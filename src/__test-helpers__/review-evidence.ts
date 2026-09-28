/** Current-contract evidence for pre-existing presentation fixtures.
 * This is test data construction, never a production legacy migration.
 */
export function currentReviewFixture(value: unknown, headSha: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const envelope = value as Record<string, unknown>;
  if (envelope.schema !== "play-review/findings/v2") return value;
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
  const { incomplete_topical_routes, ...rest } = envelope;
  return {
    ...rest,
    schema: "play-review/findings/v3",
    review_head_sha: headSha,
    findings,
    carry_forward: carry,
    prior_dispositions: [],
    incomplete_review_routes: incomplete_topical_routes,
    verification: {
      state: selected.length ? "completed" : "not-required",
      selected_ids: [...new Set(selected)],
      reason: "Fixture verification selection",
    },
  };
}
