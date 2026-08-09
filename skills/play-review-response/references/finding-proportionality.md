# Finding Proportionality Runtime Reference

This portable runtime copy is derived from the durable policy source
`docs/guidelines/writing-skills.md`. It exists so installed review skills can
apply the policy without repository-local documentation. The guideline remains
the source of origin.

Before mutating source in response to a finding, classify it as exactly one of:

1. in-scope product blocker;
2. adjacent independently releasable defect;
3. proof or test defect; or
4. invalid or speculative.

An in-scope product blocker requires all of: a reachable production path, an
authoritative contract violation, a meaningful bad outcome, and a minimal
behavioral regression. Severity, critic validity, and technical fixability are
evidence, not mutation authority.

- Apply the smallest authorized production correction only for an in-scope
  product blocker.
- Route an adjacent defect independently without changing the active issue.
- Repair a proof or test defect only at its existing proof owner and without
  expanding production behavior.
- Do not mutate for an invalid or speculative finding.
