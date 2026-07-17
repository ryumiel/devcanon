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
  such as model capability, effort level, tool access, sandbox mode, or Codex
  approval policy (`codex.approval_policy`).
- You need a reusable specialist delegate, but the reusable operational
  knowledge still lives in skills.

That is the full justification surface. If the wrapper does not add one of
those constraints, prefer the skill alone.

### Use the semantic catalog before creating a role

ADR-0027's post-migration catalog has exactly six semantic roles: `assessor`,
`investigator`, `executor`, `implementer`, `reviewer`, and `deep-reviewer`.
While ADR-0027 remains Proposed, this catalog is an authoring target: use the
roles and procedures present in the current source implementation, and do not
dispatch a target-only role or rely on the target-only runtime guard. After the
ADR acceptance gate passes, use the six-role catalog as the existing catalog.
Its exact capability, effort, tool, sandbox, and mutation defaults live in the
[agent spec](../specs/agents.md#semantic-role-catalog). The
[Agent Routing and Mutation Policy](agent-routing-and-mutation-policy.md) owns
the evolving skill and direct-child matrices, not the role envelope.

Use the existing role when its semantic identity fits, and keep the dispatch's
task prompt, inputs, output contract, retry behavior, and termination in the
owning skill. Do not create a workflow-named role, a provider/model-named role,
an effort-named role, or a second role solely to carry a different task prompt.

Source mutation and external-system mutation are independent dispatch
authorities. Neither is granted by model capability, effort, tools, network,
sandbox, or approval policy. Every semantic child role has external authority
`none`; only the owning root/controller may hold separately authorized
`external-mutable` authority.

Codex `sandbox_mode` and `approval_policy` are reusable inherited
configuration defaults or layers, not immutable enforcement. A live parent or
runtime policy can apply a different setting. Treat them as target configuration
to classify alongside authority, never as proof that source or external writes
are prevented.

## 3. Anti-Patterns

Avoid these cases:

- Wrapping a skill in an agent without adding any real constraint or role
  boundary.
- Creating generic orchestration agents that mostly route work instead of
  owning a specific reusable role.
- Using agent creation as a response to prompt growth instead of moving shared
  method content into skills.
- Giving broad permissions by default when least privilege would work.
- Treating `workspace-write` or a `Write` tool as permission to modify durable
  source. Source-immutable roles use those capabilities only for a single
  dispatch-named direct-child `.ephemeral` handoff.
- Treating sandbox or approval values as immutable enforcement. A hard
  non-mutation claim requires an actually enforced read-only policy.
- Inferring GitHub, Linear, Notion, or other external mutation authority from
  source authority or target capabilities.
- Treating delegation or orchestration as a YAML field or schema control knob.
  Those expectations belong only in prose instructions, not in
  first-class source-schema fields.
- **Project-internal references in `instructions:` prose.** Agent
  instructions render into user-wide installations and must read
  coherently outside this repo. Avoid ADR numbers (`ADR-NNNN`),
  GitHub issue/PR shorthand (`#NNN`), and `github.com/<owner>/<repo>`
  links in the agent body. Use self-contained prose; if rationale
  lives in an ADR, summarize the conclusion inline rather than
  linking. The current `agents/` files already follow this — keep it
  that way.

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
  dedicated model capability, effort level, tool access, sandbox mode, or Codex
  approval policy (`codex.approval_policy`). Constraint potential is necessary
  but not sufficient — it sharpens an already-justified promotion, it does not
  justify one.
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

The spec-owned example linked in § 6 models this. For the full rule, red flags,
and mechanical constraints, see
[`../specs/skills.md`](../specs/skills.md) § Description style. The agent spec
mirrors the same rule:
[`../specs/agents.md`](../specs/agents.md) § Description style.

## 6. Canonical Agent Example

The [agent spec's target example](../specs/agents.md#adr-0027-assessor-source-example)
is the single owner of the canonical `assessor` source definition and its exact
observable target fields. Use that example when checking capability, effort,
tools, sandbox, source-immutable instructions, and external default. Do not copy
the YAML into this guide; keeping one exact example prevents the authoring
procedure from becoming a competing role-envelope owner.

Reusable methods still stay in skills. The owning workflow must guard a
source-immutable dispatch before consuming the result; the spec-owned
write-capable envelope permits the optional named handoff and does not grant
durable-source authority.

Each source-immutable role must state the complete three-part boundary in its
own instructions: no durable file edits, no mutating commands outside the one
dispatch-named direct-child `.ephemeral` handoff lifecycle, and no GitHub,
Linear, Notion, or other external writes. The same instruction text must render
to both targets. Render checks are behavioral evidence only; broader-permission
trials must inspect relevant repository and modeled external-action state,
state residual unobserved risk, and never be presented as a security proof.

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
7. Choose model capability independently from target-native effort. Capability
   does not imply tools, sandbox, approval policy, context, authority,
   orchestration, retries, or escalation behavior.
8. Declare source authority using the closed policy vocabulary. Keep every
   semantic child's external authority at `none`; reserve separately authorized
   `external-mutable` authority for the owning root/controller. For
   source-immutable dispatches, require the three-part self-contained boundary,
   owner-side capture, verify-before-consume, and exact cleanup.
9. Validate with `devcanon validate`.
10. Preview the generated output with `devcanon render`.

## 8. See Also

These docs remain authoritative for schema and command details:

- [`../specs/agents.md`](../specs/agents.md)
- [Agent Routing and Mutation Policy](agent-routing-and-mutation-policy.md)
- [`../specs/skills.md`](../specs/skills.md)
- [`../specs/cli-commands.md`](../specs/cli-commands.md)
- [`../../AGENTS.md`](../../AGENTS.md) and [`../../MAP.md`](../../MAP.md) for
  canonical repo orientation and navigation

Use this file as guidance, not as a replacement for the schema or command
references.
