# ADR-0026: Replace Model Tiers with Capability Profiles

## Status

Accepted

This decision partially supersedes only the model-tier glossary and resolution
choice in [ADR-0005](adr-0005-per-target-skill-rendering.md) and the tier-plus-
effort default catalog in
[ADR-0025](adr-0025-codex-model-tier-selection.md). Their remaining historical
rationale and evidence stay accepted.

## Context

The former model-tier contract combined two independent choices: which target
model should perform the work and how much target-native reasoning effort it
should use. It also exposed target model placeholders in agent target blocks.
That made a neutral tier look like a provider equivalence and made changing a
model implicitly change effort.

DevCanon needs a small portable vocabulary for model capability while keeping
effort and other execution constraints explicit. The source schema, not this
prose record, remains the executable authority.

Provider documentation supplies evidence about available model families and
native configuration surfaces, but it does not define DevCanon's cross-target
policy. Anthropic documents the current Claude model IDs and characterizes
Haiku, Sonnet, and Opus differently in its
[model overview](https://platform.claude.com/docs/en/about-claude/models/overview).
Claude Code documents full model names, aliases, effort, and subagent model
fields in its
[model configuration](https://code.claude.com/docs/en/model-config) and
[subagent](https://code.claude.com/docs/en/sub-agents) references. OpenAI
documents the named GPT-5.6 Codex models and independent reasoning-effort
selection in the
[Codex model guide](https://developers.openai.com/codex/models), while the
[Codex configuration reference](https://developers.openai.com/codex/config-reference)
documents the native model and reasoning-effort fields.

## Decision

DevCanon source configuration version 2 has exactly three capability profiles:
`efficient`, `balanced`, and `frontier`. Each profile maps directly to one
Claude model string and one Codex model string. Profiles contain models only;
they do not contain effort or any other execution setting.

The accepted catalog is:

| Capability  | Claude                      | Codex           |
| ----------- | --------------------------- | --------------- |
| `efficient` | `claude-haiku-4-5-20251001` | `gpt-5.6-luna`  |
| `balanced`  | `claude-sonnet-5`           | `gpt-5.6-terra` |
| `frontier`  | `claude-opus-4-8`           | `gpt-5.6-sol`   |

These rows are DevCanon policy mappings, not claims that the paired provider
models are equivalent.

Agents may select one profile with the top-level `capability` field. Model
resolution is target-local and follows this precedence:

1. a literal model in the target block;
2. the target model mapped by top-level `capability`;
3. omission, allowing the target's ambient model selection.

Effort remains an explicit target-native field: `claude.effort` or
`codex.model_reasoning_effort`. An explicit effort is rendered; otherwise the
field is omitted and the target's ambient behavior applies. Capability
resolution never supplies, inherits, or changes effort.

Skill prose and top-level string fields in skill target overrides may use only
the canonical `{{model:efficient}}`, `{{model:balanced}}`, and
`{{model:frontier}}` tokens. Agent target `model` fields accept literal target
model strings only; model placeholders there are invalid.

Version 2 is a clean boundary. DevCanon does not provide v1 compatibility,
automatic translation, custom capability names, transitional aliases, or
legacy profiles.

The Claude mapping is inferred from the official Anthropic and Claude Code
documentation above. Exact Claude Code runtime availability and the
compatibility of every mapped model with every explicit effort remain
unverified because no live Claude session was available. That limitation does
not block the local source-policy decision; operators must verify their own
client and account before deployment. The Codex mapping retains the dated
selection evidence recorded in ADR-0025, while effort is now chosen separately.

## Consequences

- Configuration and agent sources must migrate manually to version 2; v1 input
  fails before ordinary schema validation.
- Model capability can be changed without silently changing target-native
  effort, tools, sandbox, approval policy, context, authority, or workflow
  policy.
- Model strings remain locally validated syntax. DevCanon does not establish
  provider entitlement or silently fall back when a client or account rejects
  a selection.
- Generated and installed outputs remain derived. Ignored `generated/`
  previews may be regenerated for local verification but are never committed
  as authority.
- Future catalog changes require new provider evidence, local render coverage,
  and an explicit DevCanon policy decision.
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
