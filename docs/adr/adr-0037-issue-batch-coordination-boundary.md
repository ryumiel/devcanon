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
copying their decision tables or granting new mutation authority. The router
alone decides whether an independently discovered mapped owner can be reused
when active start-work authority arrives; a coordinator handoff or read-only
mapping cannot supply a route key or effect authority. That reuse retains the
existing owner boundary and does not add a coordinator-owned creation, priming,
or release protocol.

Owner reports drive continuation. The coordinator yields after routing and
does not poll owner progress; bounded reads validate initial binding, received
reports, explicit status requests, or concrete uncertain-operation recovery.
Initial setup establishes a supported reporting path and recipient-verifiable
human messaging authority where the sending host requires it. Compatible
reporting authority is retained rather than requested again at every gate.
The watchdog, when enabled, observes external events without becoming a second
coordinator or substituting general progress polling for delivery. The accepted
issue #852 exception reuses per-item wait reasons, existing owner/action bindings,
cadence and notification state: while the coordinator is inactive, compact
checks of registered ordinary owners with pending `owner_result` waits may
request reconciliation. Internal sub-agents and user-confirmation waits are
excluded. Idle/terminal status supplies no verdict or continuation authority;
the coordinator inspects actual outcomes through existing gates. No new
registry, scheduler or consumption-acknowledgement protocol is introduced.

Canonical policy refresh is part of coordination. Concrete execution defaults
new eligible owners to autonomous execution and requests one separate host
watchdog with an active timer, within actual host authorization. Explicit
interactive-owner and no-monitor choices are independent; status-only intent
remains read-only and compatible resumed settings and explicit stops survive.
Select requested effects before permission, preference or capability inquiries.
No-monitor and retained stops exclude watcher creation, monitor-specific messaging
authorization, capability/model/cadence inquiries and activation; independent
authorized owner work continues in its selected mode. Generic resume preserves
stops. An explicitly requested active-timer stop retains its bounded host
control/permission checks and observed shutdown, without replacement authority.
The initial authorization check reuses verifiable human decisions and collects
only missing host permissions/preferences before affected effects. Startup also
establishes separately scoped delivery authority for publication, conditional
merge and scoped cleanup. Compatible human scope survives changed heads, while
readiness and exact action bindings are refreshed before the existing effect
owner executes a satisfied covered action without generic reapproval. Initial
PR publication retains implementation, validation and independent Phase 7
branch review. Under ROUTE-007-REVIEW, covered existing-PR corrections instead
require classified dispositions, local validation, the concrete pre-push summary
and exact plain-update binding, then successful publication and independent
published-current-head full-versus-narrow follow-up before readiness or merge.
Old-head approval never transfers; feedback, current CI, protection, mergeability
and exact bindings remain required at their owning gates. The watchdog
observes external events and reports to known authorized recipients; periodic
general owner-progress polling is prohibited apart from that narrow separate
watchdog exception. It adds no DevCanon scheduler and does not
guarantee compliance. Invocation restrictions and timer behavior must
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
