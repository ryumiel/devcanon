# ADR-0025: Select Named GPT-5.6 Codex Tiers

## Status

Accepted

The tier-plus-effort default catalog in this record is partially superseded by
[ADR-0026](adr-0026-capability-profiles.md). The frozen evaluation protocol,
dated Codex evidence, named-model pinning rationale, local-validation boundary,
and runtime-smoke findings remain accepted historical evidence.

## Context

DevCanon has two Codex default populations. The repository configuration uses
GPT-5.5 for all three tiers, while newly initialized libraries use GPT-5.4 Mini
for `fast` and GPT-5.4 for `standard` and `deep`. Changing those defaults affects
new libraries and the shipped agents that inherit `standard` or `deep`.

A model identifier being accepted by local configuration validation does not
prove that a Codex client understands it or that an account may run it. Model
selection therefore needs a reproducible quality gate and a separate runtime
smoke gate before a candidate becomes a repository default.

The public model catalog is time-sensitive. On 2026-07-10, OpenAI documented
GPT-5.6 Sol, Terra, and Luna as named family members, with `gpt-5.6` resolving to
Sol, and documented reasoning efforts through `max`. The
[latest-model guide](https://developers.openai.com/api/docs/guides/latest-model),
[model catalog](https://developers.openai.com/api/docs/models), and
[Codex model-selection guide](https://developers.openai.com/codex/models) are
external evidence, not DevCanon contract authority.

## Decision

### Frozen evaluation protocol

The evaluation uses three independent, read-only Codex CLI runs for every
matrix cell. The corpus, output bounds, rubric, matrix, and thresholds are fixed
before results are considered; they must not be relaxed or reinterpreted after
a result is known.

The corpus is:

1. **Fast required facts.** Report the active and initialized fast model
   values, whether effort is present and its value when present, and both
   authoritative source paths. The output is at most 150 words and contains one
   conclusion plus path-backed evidence. A wrong source value, invented path,
   or claim that local validation proves runtime entitlement is a critical
   error.
2. **Standard required facts.** Identify the shared Codex effort-enum
   authority, both tier and agent consumer fields, focused tier/config and agent
   tests, and the owning configuration and agent specifications. The output is
   at most 300 words and is a scoped change map with path-backed evidence.
   Missing a shared consumer, duplicating enums, proposing remote validation,
   or adding unrelated renderer-format work is a critical error.
3. **Deep required facts.** Reconcile both default populations, target
   isolation, the shared effort and `ultra` boundary, the init consumer,
   shipped-agent render consumers, owning specs, ADR and MAP impact, and the
   fail-closed entitlement rule. The output is at most 500 words and gives a
   compliance verdict with blocking gaps and path-backed evidence. A wrong
   mapping, omitted population, Claude cross-target change, unsafe evidence
   reuse, or changing defaults before the gate is a critical error.

Each run receives one point for each of four dimensions:

1. completeness;
2. citation validity;
3. correctness without contradictions; and
4. contract quality, including the authority/consumer boundary and avoidance
   of forbidden behavior.

A run passes only when it completes successfully, scores 4/4, has no critical
error, and meets its word bound. A configuration passes only when all three
runs pass. The matrix is:

| Tier       | Active baseline      | Initialized baseline            | Candidate               | Lower-effort comparison  |
| ---------- | -------------------- | ------------------------------- | ----------------------- | ------------------------ |
| `fast`     | `gpt-5.5` / `low`    | `gpt-5.4-mini` / effort omitted | `gpt-5.6-terra` / `low` | Not applicable           |
| `standard` | `gpt-5.5` / `medium` | `gpt-5.4` / `medium`            | `gpt-5.6-sol` / `high`  | `gpt-5.6-sol` / `medium` |
| `deep`     | `gpt-5.5` / `high`   | `gpt-5.4` / `high`              | `gpt-5.6-sol` / `xhigh` | `gpt-5.6-sol` / `high`   |

Every run records completion, rubric score, critical-error disposition, word
bound, wall time, and the input, cached-input, output, and reasoning token
classes reported by the CLI. Medians are comparative evidence, not independent
pass thresholds.

The predetermined mapping may be accepted only when each candidate has three
passing runs; its median score is not lower than either applicable baseline;
the `standard` and `deep` candidate median is not lower than the one-lower
effort comparison; and every selected pair passes a separate compatible-client
runtime smoke. Because passing runs necessarily score 4/4, a score tie accepts
the predetermined quality-first mapping.

### Evaluation environment and aggregate results

The evaluation ran on 2026-07-10 on Darwin arm64. It used ephemeral
`@openai/codex` 0.144.1 invocations, the eligible local Codex account, a
read-only sandbox, and the same repository revision for all cells. The global
Codex installation and user configuration were not upgraded or changed.

All 33 runs completed and emitted every required token class. The score column
lists the three independent run scores. `PASS` means all three runs satisfied
the complete run gate; `FAIL` records a strict rubric failure rather than a
runtime failure.

| Tier and configuration            | Run scores | Passing runs | Median input | Median cached | Median output | Median reasoning | Median wall time | Simplified API proxy | Disposition                                             |
| --------------------------------- | ---------- | -----------: | -----------: | ------------: | ------------: | ---------------: | ---------------: | -------------------: | ------------------------------------------------------- |
| Fast `gpt-5.5` / `low`            | 4, 4, 4    |          3/3 |       82,131 |        50,816 |           702 |               95 |           22.4 s |              $0.1947 | PASS                                                    |
| Fast `gpt-5.4-mini` / omitted     | 4, 4, 4    |          3/3 |      118,530 |        90,624 |         1,615 |              605 |           34.7 s |              $0.0351 | PASS                                                    |
| Fast `gpt-5.6-terra` / `low`      | 4, 4, 4    |          3/3 |       66,957 |        49,920 |           449 |               72 |           34.7 s |              $0.0618 | PASS                                                    |
| Standard `gpt-5.5` / `medium`     | 4, 4, 4    |          3/3 |      124,877 |        93,696 |         2,025 |              473 |           56.5 s |              $0.2539 | PASS                                                    |
| Standard `gpt-5.4` / `medium`     | 4, 4, 4    |          3/3 |       89,268 |        48,128 |         2,164 |              332 |           46.9 s |              $0.1473 | PASS                                                    |
| Standard `gpt-5.6-sol` / `high`   | 4, 4, 4    |          3/3 |      109,671 |        88,832 |         1,984 |              705 |           53.3 s |              $0.2081 | PASS                                                    |
| Standard `gpt-5.6-sol` / `medium` | 4, 4, 4    |          3/3 |       85,154 |        65,536 |         1,348 |              272 |           35.3 s |              $0.1867 | PASS                                                    |
| Deep `gpt-5.5` / `high`           | 3, 3, 3    |          0/3 |      467,129 |       366,464 |         5,227 |            1,460 |          129.8 s |              $0.7883 | FAIL: incomplete shared-consumer boundary               |
| Deep `gpt-5.4` / `high`           | 4, 3, 3    |          1/3 |    1,181,188 |     1,090,304 |        10,289 |            4,685 |          221.4 s |              $0.6653 | FAIL: incomplete boundary or invalid support citation   |
| Deep `gpt-5.6-sol` / `xhigh`      | 4, 4, 4    |          3/3 |      675,774 |       609,792 |         5,735 |            2,610 |          130.6 s |              $0.8069 | PASS                                                    |
| Deep `gpt-5.6-sol` / `high`       | 4, 4, 3    |          2/3 |      302,232 |       253,952 |         3,681 |            1,509 |           99.3 s |              $0.4739 | FAIL: one response lacked path-backed reviewer evidence |

The simplified API proxy column is an API-equivalent comparison aid, not an
exact cost estimate or a charged Codex subscription cost. It uses the token
classes reported by the CLI and regular public API prices published on
2026-07-10. Baseline prices come from the
[OpenAI model catalog](https://developers.openai.com/api/docs/models); GPT-5.6
prices and the 90% cache-read discount come from the
[GPT-5.6 preview announcement](https://openai.com/index/previewing-gpt-5-6-sol/).
For each run, the proxy is:

```text
((input - cached input) * input rate
 + cached input * cached-input rate
 + output * output rate) / 1,000,000
```

Reasoning tokens are retained as a reported comparison class and are not added
again to the output class in the proxy. The CLI token classes do not distinguish
cache-write tokens from cache reads and do not report the per-request context
lengths needed to identify long-context pricing adjustments. The proxy therefore
treats every reported cached-input token at the public cache-read rate and uses
the base input and output rates. Cache-write charges and long-context uplifts
are explicitly unmeasurable from the recorded evidence and are excluded rather
than invented. The table reports the median of the three per-run proxies and is
only a directional comparison for this fixed protocol; it does not represent
an invoice, subscription debit, or guaranteed API bill.

The selected candidates all passed 3/3 at 4/4. Fast tied both baselines on
quality and was the least expensive selected tier. Standard/high tied both
baselines and standard/medium on quality. Deep/xhigh exceeded both baseline
medians and tied deep/high on quality. The predetermined quality-first rule
therefore accepts the ties; latency, tokens, and proxy cost remain visible
tradeoffs but do not override the passing quality decision.

### Runtime smoke and availability boundary

Separate selected-pair smokes under Codex CLI 0.144.1 returned the exact success
marker for all three pairs:

| Selected pair           | Result | Wall time |
| ----------------------- | ------ | --------: |
| `gpt-5.6-terra` / `low` | PASS   |     6.2 s |
| `gpt-5.6-sol` / `high`  | PASS   |     4.2 s |
| `gpt-5.6-sol` / `xhigh` | PASS   |     3.9 s |

Codex CLI 0.143.0 rejected `gpt-5.6-terra` before task execution and required a
newer client. This is classified as client/model-metadata incompatibility, not
a DevCanon schema error and not proof that the account lacks entitlement. The
0.144.1 successes prove only that the selected pairs loaded in the evaluated
client/account/environment on the stated date.

DevCanon validation remains local and syntactic. It must not query provider
availability or claim that an accepted model string is remotely runnable.
Deployment must fail closed when the selected client/account smoke cannot be
reproduced; no alias, family member, model, or effort may be substituted.

### Selected mapping and pinning policy

The following table records the mapping selected by this historical decision.
ADR-0026 now owns the active model-only capability catalog and requires effort
to be selected explicitly and independently.

This decision selected the following Codex mapping for both the then-active
repository config and newly initialized libraries:

| Tier       | Model           | Reasoning effort |
| ---------- | --------------- | ---------------- |
| `fast`     | `gpt-5.6-terra` | `low`            |
| `standard` | `gpt-5.6-sol`   | `high`           |
| `deep`     | `gpt-5.6-sol`   | `xhigh`          |

Named family members were pinned instead of the moving `gpt-5.6` alias. This
makes a DevCanon revision's intended model stable if an alias is later
retargeted. DevCanon does not add automatic family-member routing. ADR-0026
preserves named Codex models while replacing tiers with independent capability
and effort choices.

At acceptance, the shared Codex reasoning-effort authority was required to
accept `max` for both tier `reasoning_effort` and agent
`model_reasoning_effort`. ADR-0026 removes effort from capability profiles;
agent `model_reasoning_effort` remains an explicit target-native field.
`ultra` remains invalid because it is an orchestration mode, not a
reasoning-effort value in this contract. Local acceptance of `max` does not
establish remote support for a particular model or account.

Only aggregate measurements, decisions, and public links belong in this ADR.
Transient execution records, identifiers, and temporary artifacts are not
durable evidence and must not be committed.

## Consequences

- At acceptance, the active and initialized Codex defaults could migrate
  together to the exact selected named-family mapping; neither population was
  to be updated alone.
- The former standard/deep agents inherited the selected model and effort
  unless an explicit agent override applied. ADR-0026 now requires independent
  capability and explicit effort choices.
- This decision did not change the then-existing Claude tier values or Claude
  rendering.
- Configuration and agent specifications were required to document
  named-family pinning, `max`/`ultra`, effort inheritance, and the
  local-validation/runtime boundary. Current specs document the successor
  capability contract.
- Focused schema, initialization, and shipped-agent render tests must prove the
  new contract. The rendered TOML shape does not change.
- Future model migrations must declare their corpus and gate before changing
  defaults, and must record new dated evidence instead of treating these
  measurements as timeless provider facts.
- Operators need a compatible Codex client and an entitled account. A client
  or account failure blocks deployment rather than causing fallback selection.

## Alternatives considered

- **Use the moving `gpt-5.6` alias for standard and deep.** Rejected because an
  unchanged DevCanon revision could silently resolve to a different family
  member later.
- **Omit model selection and accept Codex automatic selection.** Rejected
  because it makes the shipped tier contract non-reproducible and prevents
  exact selected-pair smoke verification.
- **Keep the existing defaults and add syntax support only.** Rejected because
  the completed gate supports a coordinated migration and retaining split
  generations would leave active and initialized behavior inconsistent.
- **Select the one-lower effort for standard or deep.** Rejected under the
  predetermined quality-first rule. The selected efforts tied the lower effort
  on median quality, so the declared tie rule chooses `high` and `xhigh` while
  retaining the measured cost and latency tradeoff.
