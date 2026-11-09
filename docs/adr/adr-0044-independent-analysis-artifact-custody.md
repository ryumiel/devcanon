# ADR-0044: Separate analysis acceptance from posting custody

## Status

Accepted

## Context

Canonical artifact names and review leases couple semantic-result delivery to a
particular review checkout and posting lifecycle. Independent reviews of the same
revision can collide even when an existing source checkout is suitable. Relaxing
paths alone would discard the existing identity guard without replacing it.

## Decision

Use exclusive per-analysis directories and the existing original-artifact custody
and handoff/result families. Retain producer-original source/root identity and
result integrity through the established owner/controller handoff. Validate full
current semantic evidence independently of leases. Keep source cwd/head checks and
ordinary leased posting with explicit current payload approval and uncertain-effect
reconciliation. Reuse exact snapshot disposal for owned scratch in borrowed source.

The [workflow spec](../specs/afds-workflow-routing.md#review-analysis-001-independent-analysis-completion)
owns observable behavior; the
[runtime spec](../specs/passive-runtime.md#independent-analysis-artifact-contract)
owns custody/validation, and source types own concrete deployed interfaces.

## Consequences

Same-revision analyses can coexist and complete without lease mutations. Consumers
must receive original custody rather than authenticate replaceable files against
their own hashes. Borrowed source remains protected. Existing live leases and
posting/replay rules remain intact; no new registry or artifact family is needed.

## Alternatives considered

- Keep leases for every review: retains avoidable checkout/posting coupling.
- Accept arbitrary paths/self-reported hashes: lacks independent root authority.
- Build general canonical import/immutable-source support: unnecessary for the
  demonstrated existing-checkout analysis path; ordinary posting remains available.
