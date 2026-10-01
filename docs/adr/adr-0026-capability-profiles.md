# ADR-0026: Replace Model Tiers with Capability Profiles

## Status

Accepted

This decision partially supersedes the model-tier glossary and resolution
choice in [ADR-0005](adr-0005-per-target-skill-rendering.md). Its remaining
historical rationale stays accepted.

[ADR-0035](adr-0035-installed-runtime-configuration-discovery.md) supersedes
this decision only for the installed-runtime catalog lifecycle and a
controller's consumption of an already-rendered route binding. This ADR remains
the decision owner for the capability-profile vocabulary and model-resolution
mechanism. Specific provider model identifiers are mutable configuration,
not architectural decisions.

## Context

The former model-tier contract combined two independent choices: which target
model should perform the work and how much target-native reasoning effort it
should use. It also exposed target model placeholders in agent target blocks.
That made a neutral tier look like a provider equivalence and made changing a
model implicitly change effort.

DevCanon needs a small portable vocabulary for model capability while keeping
effort and other execution constraints explicit. The source schema, not this
prose record, remains the executable authority.

Provider documentation supplies evidence about available models and native
configuration surfaces. Runtime availability remains a client/account fact,
separate from locally validating model-string syntax.

## Decision

DevCanon source configuration version 2 has exactly three capability profiles:
`efficient`, `balanced`, and `frontier`. Each profile maps directly to one
Claude model string and one Codex model string. Profiles contain models only;
they do not contain effort or any other execution setting.

The repository catalog is owned by `devcanon.config.yaml`, scaffold defaults
by `src/config/defaults.ts`, and the bundled runtime catalog by
`skills/devcanon-runtime/config/runtime-config.json`. Agent target overrides
are owned by `agents/*.yaml`. Model updates change these configuration sources
and their consumers without amending an ADR. Ordinary configuration and render
checks verify consistency; they must not pin provider model identifiers in
independent test expectations. Paired provider values do not imply model
equivalence.

Agents may select one profile with the top-level `capability` field. Codex model
resolution follows this precedence for `codex.model`:

1. explicit `null` under the agent-source contract suppresses Codex resolution
   and model emission;
2. a literal model in the target block emits that literal;
3. an absent field permits the Codex model mapped by top-level `capability`;
4. absent capability resolution leaves the Codex model omitted.

Explicit suppression bypasses resolution; it does not alter the model-only
capability catalog or couple a profile to effort. Fresh route dispatch remains a
separate controller concern: the selected capability produces a binding for the
dispatch primitive during rendering, then dispatch consumes that literal full model with
independent route effort. Dispatch does not rediscover source configuration or
the sibling runtime catalog to select or replace a model.

Claude model selection remains literal-or-absent; `claude.model: null` is
rejected by the agent-source contract. The agent spec owns both target-specific
source rules.

Effort remains an explicit target-native field: `claude.effort` or
`codex.model_reasoning_effort`. An explicit effort is rendered; otherwise the
field is omitted and the target's ambient behavior applies. Capability
resolution never supplies, inherits, or changes effort.

Skill prose and top-level string fields in skill target overrides may use the
canonical target-native `{{model:efficient}}`, `{{model:balanced}}`, and
`{{model:frontier}}` tokens. Prose that passes a value to an explicit Codex
execution primitive may instead use the corresponding
`{{model-codex:<capability>}}` form, which selects the Codex catalog member in
both artifact targets. Agent literal target `model` fields reject model
placeholders; the agent spec's `codex.model: null` suppression is the only
non-literal model-source state.

Version 2 is a clean boundary. DevCanon does not provide v1 compatibility,
automatic translation, custom capability names, transitional aliases, or
legacy profiles.

Local validation establishes syntax and source/render consistency, not provider
entitlement. Live dispatch handles client/account availability through the
owning route's existing unavailable or rejected-pair behavior. No separate
runtime qualification campaign is required for catalog maintenance.

## Consequences

- Configuration and agent sources must migrate manually to version 2; v1 input
  fails before ordinary schema validation.
- Model capability can be changed without silently changing target-native
  effort, tools, sandbox, approval policy, context, authority, or workflow
  policy. Explicit source null likewise changes only source-to-render model
  emission; it does not change a capability profile or route effort.
- Model strings remain locally validated syntax. DevCanon does not establish
  provider entitlement or silently fall back when a client or account rejects
  a selection.
- Generated and installed outputs remain derived. Ignored `generated/`
  previews may be regenerated for local verification but are never committed
  as authority.
- Future model updates require configuration and render consistency checks;
  they do not require a new ADR or a fixed provider-model test snapshot.
- Accepted ADRs such as ADR-0007 and ADR-0008 retain former model-tier terms as
  historical decision evidence. Compatibility fixtures and tests may also name
  removed fields or tokens to prove rejection. Those occurrences are not
  current authoring guidance.
- This decision adds no contribution, review, root-instruction, ADR-authoring,
  or documentation-governance rule. `CONTRIBUTING.md`, `WORKFLOW.md`,
  `AGENTS.md`, the PR and code-review guidelines, PR template, ADR template,
  documentation standard, and documentation checklists therefore remain
  unchanged.

## Alternatives considered

- **Keep model tiers with bundled effort.** Rejected because capability and
  target-native effort are independent decisions.
- **Translate v1 tiers automatically.** Rejected because old tier names do not
  determine the operator's intended capability and effort independently.
- **Allow custom, transitional, or legacy profiles.** Rejected to keep the
  portable vocabulary exact and mechanically verifiable.
- **Omit a neutral model vocabulary.** Rejected because shared skills and
  agents still need target-portable model selection.

## See also

- [Configuration](../specs/configuration.md)
- [Agents](../specs/agents.md)
- [Skills](../specs/skills.md)
- [Capability Profiles v2 Migration](../guidelines/capability-profiles-v2-migration.md)
- [`src/render/capability-profiles.ts`](../../src/render/capability-profiles.ts)
