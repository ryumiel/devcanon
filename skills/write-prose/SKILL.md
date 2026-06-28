---
name: write-prose
description: Drafts, revises, adapts, and reviews prose while preserving meaning, evidence, terminology, and artifact-owner contracts. Use when writing or polishing English, Korean, bilingual, technical, stakeholder, or publication prose, including naturalization, anti-AI cleanup, tone adjustment, and style findings. Do not use to decide product intent, behavior requirements, Linear mutation policy, or documentation audit scope.
---

# Write Prose

Use this skill for meaning-preserving prose work: drafting, rewriting,
polishing, translation/adaptation, Korean naturalization, English anti-AI
cleanup, tone adjustment, bilingual alignment, and prose-quality review.

This skill may also be used as a support pass inside another authoring
workflow, but only after that owner workflow has selected the artifact type,
evidence contract, required structure, and mutation mode. Prose polish must
not take over owner decisions.

## Authority Boundaries

`write-prose` owns sentence quality, language adaptation, tone, terminology
consistency, local rewrite discipline, and prose findings.

It does not own product intent, behavior requirements, issue slicing,
architecture decisions, roadmap direction, documentation audit scope,
publication approval, or external-system mutation policy.

Route owner artifacts before prose polish:

- Product requirements requests belong to the product-requirements owner
  workflow first.
- Behavior specification requests belong to the product-spec owner workflow
  first.
- Linear project descriptions and project updates belong to the relevant
  Linear owner workflow first.
- Documentation health checks and audits belong to the documentation-audit
  owner workflow first.

When supporting an owner workflow, preserve its headings, required fields,
evidence appendix boundaries, status labels, action mode, health decision,
acceptance criteria, mutation gates, and no-external-mutation rules. If a
style improvement conflicts with source evidence, claim authority, or an owner
contract, report the conflict instead of rewriting through it.

Example: a request to polish a Linear project update draft may use
`write-prose` only after the Linear update workflow has established the draft,
health decision, issue-evidence separation, and `create` or `update` action
mode. The prose pass may improve the postable wording; it must not change the
action mode, move issue IDs into the postable body, or publish anything.

## Side Effects

Make local file edits only when the user or owner workflow explicitly asks for
file edits. Do not mutate external systems: no tracker changes, Linear writes,
GitHub writes, publishing, install, sync, or generated-output authority
changes.

If the request is a review, produce findings rather than editing unless the
user asks for edits.

## Reference Routing

Load only the bundled reference files needed for the current task:

- Read [references/english-prose.md](references/english-prose.md) for English
  drafting, executive polish, anti-AI cleanup, claim-strength review, durable
  documentation prose, or English sections of a bilingual artifact.
- Read [references/korean-prose.md](references/korean-prose.md) for Korean
  drafting, Korean naturalization, grammar/spacing/register cleanup,
  translationese reduction, Korean AI-pattern review, or Korean publication
  prose.
- Read [references/bilingual-prose.md](references/bilingual-prose.md) for
  English/Korean bilingual work, translation/adaptation, terminology mapping,
  or alignment checks between language surfaces.
- Read
  [references/prose-review-findings.md](references/prose-review-findings.md)
  when the output is findings, when a rewrite is risky, or when the task
  needs severity, evidence, mandatory-vs-heuristic labeling, false-positive
  checks, or baseline-failure coverage.

Do not open or require any external writing vault at runtime. The bundled
references are the portable prose guidance for this skill.

## Protected Spans

Before rewriting, identify spans that must remain byte-identical unless the
user explicitly asks to change them:

- names, dates, times, numbers, units, amounts, versions, percentages;
- quotations, legal text, regulatory language, citations, source titles;
- paths, issue IDs, PR numbers, API names, CLI commands, code, model names;
- product names, official terminology, status labels, field values, headings,
  required sections, and owner-workflow control text.

If protected spans are ambiguous, keep them unchanged and flag the uncertainty.
Do not normalize owner-owned field values for style.

## Workflow

1. Establish scope and authority.
   Identify whether the task is direct prose work or support use inside an
   owner workflow. If an owner workflow should decide the artifact contract,
   route there first.

2. Select language surface and references.
   Determine whether the target is English, Korean, bilingual, or findings.
   Read only the relevant bundled reference files.

3. Mark protected spans and constraints.
   Preserve source claims, technical identifiers, terminology, register,
   structure, and owner-workflow contracts before changing wording.

4. Draft, rewrite, adapt, or review locally.
   Improve only the prose surface in scope. Remove, ground, or flag
   unsupported significance claims. Do not replace a strong unsupported claim
   with a softer unsupported claim.

5. Audit meaning.
   Compare before and after for protected spans, facts, claim strength,
   causality, actor identity, scope, negation, sequence, evidence placement,
   and information added or lost.

6. Report conflicts and residual risk.
   If the prose can be improved only by changing meaning, source authority,
   claim support, or an owner contract, leave the source-controlled text intact
   and report the issue.

## Output Rules

For rewrites, return the revised prose plus a concise note only when useful or
requested. If the user asks for "only the rewritten passage," return only the
passage unless a protected-span, source-grounding, claim-support, or authority
conflict prevents a safe rewrite. Unsupported significance, value, scale,
future-impact, or generic benefit claims are claim-support conflicts when the
source does not establish them; remove them if a meaning-preserving rewrite is
possible, otherwise report the conflict instead of polishing the claim.

For reviews, use the finding format in
[references/prose-review-findings.md](references/prose-review-findings.md).

For file edits, preserve frontmatter, links, code spans, and owner-controlled
sections unless the user explicitly requests changes to those parts.
