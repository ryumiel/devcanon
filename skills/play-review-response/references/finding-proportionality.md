# Finding Proportionality Runtime Reference

This portable runtime copy is derived from the durable policy source
`docs/guidelines/writing-skills.md`. It exists so installed review skills can
apply the policy without repository-local documentation. The guideline remains
the source of origin.

Before mutating source in response to a finding, classify it as exactly one of:

1. in-scope product blocker;
2. adjacent independently releasable defect;
3. proof or test defect;
4. authorized behavior-preserving compliance repair; or
5. invalid or speculative.

An in-scope product blocker requires all of: a reachable production path, an
authoritative contract violation, a meaningful bad outcome, and a minimal
behavioral regression. Severity, critic validity, and technical fixability are
evidence, not mutation authority.

An authorized behavior-preserving compliance repair requires a current explicit
mandatory repository rule, a concrete current-source violation, existing
current authority for the exact bounded correction, and source inspection
demonstrating preservation of intended behavior and public contracts. Capture
the rule and violation before mutation; afterward prove corrected-source rule
compliance, run appropriate static analysis or typechecks and relevant existing
behavioral tests, then validate and independently review the changed head.
Typing-only corrections need no manufactured failing runtime test. Suppression,
unsafe assertions, inferred preference, and severity alone do not qualify.
Disputed rules, uncertain preservation, new interface or dependency decisions,
widened scope, or crossed approval boundaries stop for owner handoff. Product
or control-flow changes still require the product-blocker behavioral regression
proof and cannot enter through this category.

- Apply the smallest authorized production correction only for an in-scope
  product blocker.
- Route an adjacent defect independently without changing the active issue.
- Repair a proof or test defect only at its existing proof owner and without
  expanding production behavior.
- Apply only the exact authorized behavior-preserving compliance correction
  after its rule, source, preservation, and verification proofs are established.
- Do not mutate for an invalid or speculative finding.
