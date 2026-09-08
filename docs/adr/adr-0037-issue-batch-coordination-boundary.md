# ADR-0037: Separate batch coordination from explicit routing

## Status

Accepted

## Context

Managing issue batches requires decisions about scope, dependencies, combined
readiness, owner continuity, and recovery across existing workflows. The issue
router already owns route eligibility, approval bindings, progress receipts,
and archival. Making that router the general batch entrypoint would mix policy
about managing the batch with the contracts governing individual routes.

The [skills-first architecture](adr-0001-skills-first-architecture.md) and
[skill-owned method and mutation authority](adr-0027-semantic-agent-routing-and-mutation-authority.md)
favor a reusable method without another agent identity or runtime scheduler.

## Decision

Use `issue-batch-coordination` as the entrypoint for ordinary batch-management
intent. It owns coordination policy and explicitly invokes
`issue-batch-routing` for routing work. Composition is one-way: routing remains
available through explicit user or owning-workflow invocation and does not
select the coordinator in return.

Keep route eligibility, approval bindings, receipts, and archival with the
router. The coordinator reuses existing state and owner workflows instead of
copying their decision tables or granting new mutation authority.

Canonical policy refresh is part of coordination. An optional, authorized host
watchdog may prompt refresh and recovery; it adds no DevCanon scheduler and
does not guarantee compliance. Invocation restrictions and timer behavior must
be described according to each host's actual capabilities.

[ROUTE-007](../specs/afds-workflow-routing.md#route-007-batch-coordination-and-explicit-routing)
owns the observable workflow requirements. The
[capability classification](../guidelines/afds-workflow-capability-governance.md#accepted-batch-coordination-boundary)
records the asset choice and its authority limits.

## Consequences

Ordinary batch requests have a focused method owner while existing route
contracts retain one authority. Operators must load both skills when routing
through coordination, and changes to their composition must preserve that
boundary. Policy refresh helps recover context but cannot supply missing
approval, enforce host behavior, or turn an unchanged timer wake into progress.

The same method travels across supported hosts, with explicit limits where
their invocation and scheduling controls differ.

## Alternatives considered

- Expand `issue-batch-routing`: rejected because general batch policy would
  obscure its bounded eligibility, approval, receipt, and archival ownership.
- Add a dedicated coordinator agent: rejected because the reusable need is
  method, without a distinct stable identity or target constraint.
- Add a scheduler or independent ledger: rejected because existing owner state
  and optional host scheduling suffice; another runtime would introduce
  ownership and recovery contracts beyond the coordination method.
