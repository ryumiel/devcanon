# Agent Authoring Guide

This guide answers a narrow question: when should contributors create an
agent instead of a skill?

Skills are the default reusable unit in this repo. Put reusable operational
knowledge, checklists, reference material, and methods in skills first. Create
an agent only when a thin role wrapper still adds value.

## 1. Default to Skills

Start with a skill unless you need a role wrapper for a specific target or
execution constraint.

Skills are the shared layer for reusable knowledge across Claude Code and
Codex. They keep workflows, checklists, and procedures portable and prevent
the same operational content from being duplicated across agent definitions.

If the thing you want to reuse is mostly "how to do the work," it belongs in a
skill. If you still need a distinct role identity after that, consider an
agent.

## 2. When an Agent Adds Value

In this repository, create an agent only when one of these is true:

- You need tool or sandbox restrictions that a skill cannot enforce.
- You need a stable role identity with documented target-supported constraints,
  such as model tier, effort level, tool access, sandbox mode, or Codex
  approval policy (`codex.approval_policy`).
- You need a reusable specialist delegate, but the reusable operational
  knowledge still lives in skills.

That is the full justification surface. If the wrapper does not add one of
those constraints, prefer the skill alone.

## 3. Anti-Patterns

Avoid these cases:

- Wrapping a skill in an agent without adding any real constraint or role
  boundary.
- Creating generic orchestration agents that mostly route work instead of
  owning a specific reusable role.
- Using agent creation as a response to prompt growth instead of moving shared
  method content into skills.
- Giving broad permissions by default when least privilege would work.
- Treating delegation or orchestration as a YAML field or schema control knob.
  In v1, those expectations belong only in prose instructions, not in
  first-class source-schema fields.

## 4. Promoting Prompt Templates into Agents

Some workflows in this repository use `*-prompt.md` files to assemble a
delegate prompt at dispatch time. Do not convert those files into agents
mechanically.

Promote a prompt-template delegate into a source agent only when all of these
are true:

- The delegate represents a stable reusable role identity across sessions,
  evidenced by **cross-skill reuse OR a role boundary that would still make
  sense outside the originating skill**.
- The delegate benefits from documented target-supported constraints such as
  dedicated model tier, effort level, tool access, sandbox mode, or Codex
  approval policy (`codex.approval_policy`). Constraint potential alone is
  necessary but not sufficient — it sharpens an already-justified promotion,
  it does not justify one.
- The reusable operational method can remain in skills, with the resulting
  agent staying a thin role wrapper.

**Operational threshold for reviewer-style delegates.** A reviewer-style
prompt template should accumulate at least two independent call sites before
promotion, unless there is already a hard target-native constraint win that
justifies promotion on its own (for example, a read-only sandbox plus a fixed
tool surface). Single-skill reviewer scaffolds stay as templates.

Keep a delegate as a prompt template when it is mostly:

- workflow-local prompt assembly
- phase-specific scaffolding
- placeholder substitution for task-local context

That keeps role identity in agents and workflow method in skills.

## 5. Description Style

The `description` decides when the agent gets selected. Same rule as skills —
name **what** the role is for, then **when** to delegate, in third person — with
one extra emphasis: agents benefit more from a `Do not use when…` clause,
because role selection usually hinges on disambiguating against general work or
sibling agents.

```yaml
description: <Role — what the agent does>. Use when <delegation triggers>. Do not use when <contrastive cue>.
```

The shipped examples in § 6 model this. For the full rule, red flags, and
mechanical constraints, see
[`../specs/skills.md`](../specs/skills.md) § Description style. The agent spec
mirrors the same rule:
[`../specs/agents.md`](../specs/agents.md) § Description style.

## 6. Example Agent Definitions

These examples stay inside the documented schema surface from
`docs/specs/agents.md`. The instructions are intentionally short; reusable
methods stay in skills.

If you do attach skills in a real agent, use existing skills whose workflow and
operational scope genuinely match the role's permissions and intent.

```yaml
name: reviewer
description: Focused code review role with limited tools and read-only access for correctness and regression checks. Use when a code review needs a fixed reviewer role with restricted access. Do not use for general coding work or broad orchestration.
instructions: |
  Review for correctness and regressions.
  Report only concrete findings.
claude:
  model: "{{model:standard}}"
  tools:
    - Read
    - Grep
codex:
  model: "{{model:standard}}"
  sandbox_mode: read-only
```

```yaml
name: release-checker
description: Release validation role for surfacing blockers in a release candidate. Use when validating a release candidate before cut. Do not use for feature planning or general repository maintenance.
instructions: |
  Verify the release candidate.
  Surface blocking issues first.
claude:
  model: "{{model:standard}}"
  tools:
    - Read
    - Grep
codex:
  model: "{{model:standard}}"
  sandbox_mode: read-only
```

```yaml
name: doc-curator
description: Documentation review role with narrow read-only access for clarity and consistency checks. Use when documentation needs a dedicated reviewer role. Do not use when the work is better expressed as a reusable documentation skill.
instructions: |
  Check clarity and consistency.
  Keep recommendations minimal.
claude:
  model: "{{model:standard}}"
  tools:
    - Read
codex:
  model: "{{model:standard}}"
  sandbox_mode: read-only
```

## 7. Authoring Workflow in This Repo

1. Identify reusable knowledge first, and put workflow, checklist, and
   reference content in skills.
2. Create the agent only if a thin role wrapper is still needed after that
   split.
3. For delegates currently expressed as prompt templates, decide explicitly
   whether they add stable role identity plus real target-supported
   constraints, or whether they are still workflow-local scaffolding.
4. Keep `instructions` short and role-shaped, not checklist-shaped.
5. Make the role contract explicit: what it owns, when it is used, what
   context it receives, what it returns, and whether any coordination
   expectations need to be described in prose instructions.
6. Start with least privilege: minimum tools, minimum sandbox, and no new
   schema knobs for coordination behavior.
7. Validate with `agents-manager validate`.
8. Preview the generated output with `agents-manager render`.

## 8. See Also

These docs remain authoritative for schema and command details:

- [`../specs/agents.md`](../specs/agents.md)
- [`../specs/skills.md`](../specs/skills.md)
- [`../specs/cli-commands.md`](../specs/cli-commands.md)
- [`../../AGENTS.md`](../../AGENTS.md) and [`../../MAP.md`](../../MAP.md) for
  canonical repo orientation and navigation

Use this file as guidance, not as a replacement for the schema or command
references.
