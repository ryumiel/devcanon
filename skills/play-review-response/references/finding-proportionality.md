# Finding Proportionality Runtime Reference

This portable runtime copy is derived from the durable policy source
`docs/guidelines/writing-skills.md`. It exists so installed review skills can
apply the policy without repository-local documentation. The guideline remains
the source of origin.

Before mutating source in response to a finding, classify it as exactly one of:

1. in-scope product blocker;
2. adjacent independently releasable defect;
3. proof or test defect;
4. behavior-preserving compliance candidate; or
5. invalid or speculative.

Necessary completion of the current authorized change is a bounded repair
condition, not another finding class. Before editing, record five explicit
facts: the causal link from that change to the inconsistency; the applicable
violated requirement or approved contract; why correction is necessary to
finish the change; the design-determined intended result; and current authority
for every affected responsibility. Establish exact mutation authority
separately from classification and these facts. Findings, severity, technical
fixability, `--auto`, and `--fix` supply none of them. Refresh existing scope
and reviewed-plan evidence before mutation. Missing, partial, stale, or
ambiguous facts or authority withhold mutation for the existing owner or
approval handoff.

With those facts and authority, an unchanged file, out-of-diff location,
signature adaptation to an already approved contract, second module, or
needed adjacent context does not alone deny a necessary correction. Complete
only the approved contract. Unrelated pre-existing defects, new ownership,
architecture, interface or public-contract decisions, new dependencies,
expanded responsibilities, and crossed explicit approval boundaries stop.
Retain ordinary or selected verification, Safety and Contracts hard-rule stops,
nit defaults, recurrence bounds, proof, changed-head review, and full-versus-
narrow review selection. Executable behavior or control-flow changes require
fail-before and pass-after behavioral regression proof; documentation
corrections require truthful source consistency and applicable documentation
checks without inventing a runtime failure.

An in-scope product blocker requires all of: a reachable production path, an
authoritative contract violation, a meaningful bad outcome, and a minimal
behavioral regression. Severity, critic validity, and technical fixability are
evidence, not mutation authority.

A behavior-preserving compliance candidate requires a current explicit
mandatory repository rule, a concrete current-source violation, and source
inspection demonstrating that the bounded correction preserves intended
behavior and public contracts. Classify from these facts independently of
repair authority. Capture the rule, violation, and preservation evidence before
mutation. Suppression, unsafe assertions, inferred preference, severity, critic
validity, and technical fixability alone do not qualify.

Establish current authority for the exact bounded correction separately before
mutation. Only an otherwise qualified candidate with that authority may enter
the existing bounded repair route. When exact authority is known missing,
retain the candidate class, withhold mutation, and hand off explicitly to the
existing owner or approval gate. When authority is uncertain, retain the class,
withhold mutation, and establish the missing evidence or decision through the
existing bounded fail-closed route. Disputed rules, uncertain preservation, new
interface or dependency decisions, widened scope, or crossed approval
boundaries stop for owner handoff. After an authorized edit, prove
corrected-source rule compliance, run appropriate static analysis or typechecks
and relevant existing behavioral tests, then validate and independently review
the changed head. Typing-only corrections need no manufactured failing runtime
test. Product or control-flow changes still require the product-blocker
behavioral regression proof and cannot enter through this category.

- Apply the smallest authorized production correction only for an in-scope
  product blocker.
- Route an adjacent defect independently without changing the active issue.
- Repair a proof or test defect only at its existing proof owner and without
  expanding production behavior.
- Retain a compliance candidate's classification when authority is missing or
  uncertain; only apply its exact authorized correction after pre-edit
  eligibility and all other repair gates pass. Complete corrected-source rule
  and verification proofs after editing.
- Do not mutate for an invalid or speculative finding.
