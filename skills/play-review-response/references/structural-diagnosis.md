# Structural Diagnosis

Read this procedure before writing code or a plan for an executable lifecycle-sensitive concern or a related, policy-sensitive, contract-sensitive, or cross-module cluster that requires structural diagnosis. The entry owns classification, authority, and mode selection.

For executable lifecycle-sensitive concerns, check the operation lifecycle
before writing code or a plan:

- **Start boundary** - what begins the operation and what prevents duplicate,
  same-tick, or concurrent starts?
- **Readiness boundary** - what state means the operation is allowed to proceed?
- **Success boundary** - what authoritative completion signal marks success,
  and who owns setting it?
- **Failure boundary** - what failures are recoverable, retryable, terminal, or
  user-visible?
- **Ownership** - which component owns state transitions, cleanup, disposal,
  cancellation, restart, reconnect, and externally visible effects?
- **Identity / correlation** - how events, callbacks, jobs, retries, or
  responses map to the current operation rather than a stale one.
- **Stale state and events** - how old events, old promises, cached state, or
  previous attempts are rejected or ignored.
- **Retry / cancellation / disposal / restart / reconnect** - how repeated or
  interrupted lifecycles avoid double effects and missed cleanup.
- **Cleanup** - who owns normal cleanup, stale cleanup, speculative or
  render-only cleanup, and cleanup after failure or cancellation?
- **Tests** - what focused checks cover normal, stale, cleanup, retry,
  cancellation, failure, same-tick, and concurrent paths?
- **Docs / contracts** - whether the review feedback changes public contracts,
  workflow policy, skill/agent contracts, generated-output expectations, or
  consumer-facing behavior.

## Root Cause / Structural Diagnosis

For multiple related comments, contract-sensitive, policy-sensitive,
lifecycle-sensitive, or cross-module feedback, include a `Root Cause /
Structural Diagnosis` section or equivalent evidence before deriving work
items.

Classify each related feedback cluster using the closest diagnosis:

- isolated implementation mistake.
- duplicated source of truth.
- unclear ownership or authority.
- contract drift between producer and consumer.
- missing validation boundary.
- lifecycle or correlation gap.
- test fixture mismatch hiding the real contract.

For each cluster, identify the authoritative source for the disputed behavior
and classify the fix strategy:

- patch local symptoms.
- consolidate authority.
- extract or strengthen a shared validation layer.
- update producer contract.
- update consumer adapter.
- document a no-code policy boundary.
