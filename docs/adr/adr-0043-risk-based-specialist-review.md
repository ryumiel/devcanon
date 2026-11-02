# ADR-0043: Concentrate specialist judgment on material risk

## Status

Accepted. Source definitions and dispatch consumers implement the allocation
together; installed outputs receive it through the normal explicit sync workflow.

## Context

Ordinary implementation reviews currently use frontier judgment even when the
change has no material architectural, concurrency or security risk. Specialist
attention should follow the consequence of failure and unresolved judgments.
Different model families may offer useful perspectives but do not guarantee
independence, correctness or lower total cost.

## Decision

Use Sol High for ordinary design and review, Terra Medium for implementation
and feedback repairs, and Astra High for architect consultation and significant
risk deep review. Preserve balanced as Sol and use an implementer-specific
Terra override. Preserve existing review gates and lifecycle procedures.

Keep risk guidance concise: identify the affected guarantee, reachable consequence
and question requiring specialist attention. Consult before implementing known
high-risk designs; investigate implementation risks with focused deep review.
Independent review must not reuse the consultant's session as approval.

The [agent spec](../specs/agents.md#codex-specialist-roles) owns allocation
and role responsibilities. The
[routing policy](../guidelines/agent-routing-and-mutation-policy.md#codex-specialist-routing)
owns selection guidance. The [Kiki trial](../specs/workflow-specialist-pilot.md)
owns supporting validation expectations. Existing workflow owners retain gate
completion, repair and publication authority. Existing Claude behavior remains
unchanged by the Codex allocation change.

## Consequences

A small Kiki trial can reveal missed defects, unnecessary escalation and poor
repairs without requiring a separate evaluation platform. Explicitly record the
requested configuration and distinguish unavailable observations from evidence.
The trial is supporting feedback, not a mandatory rollout gate or a controlled
experiment proving quality or savings. More rigorous comparison can follow a
specific unresolved question.

## Alternatives considered

- Frontier review for every implementation gate: does not focus specialist use.
- Changing balanced to Terra: unnecessarily changes other roles.
- New specialist route identities, retry budgets and a mandatory paired pilot:
  disproportionate to the initial model-allocation evaluation.
- Combining implementation review gates: changes coverage beyond this proposal.
