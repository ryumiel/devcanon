---
name: spec-readiness-review
description: Read-only readiness review for durable AFDS artifacts before issue slicing. Use when checking whether a PRD, behavior spec, roadmap item, guideline, ADR, or source-owner artifact is ready to become executable work. Do not use for implementation-vs-spec review.
codex_sidecar:
  interface:
    display_name: "Spec Readiness Review"
    short_description: "Check durable specs before issue slicing"
    icon_small: "./assets/review-small.svg"
    brand_color: "#16a34a"
---

# Spec Readiness Review

Review whether an owning durable artifact is ready to slice into executable work.
This skill is read-only: it reports readiness, revision needs, or blockers, but
does not approve implementation, create issues, mutate tracker state, or edit
the artifact under review.

## When to Use

Use this before drafting executable GitHub or Linear issues from an owning
durable artifact, including:

- product requirements under `docs/product-requirements/`;
- behavior specs under `docs/specs/`;
- roadmap items under `docs/roadmap/`;
- guidelines, ADRs, source-owner notes, or other durable AFDS artifacts that
  own the truth being sliced.

Do not use this after implementation exists to check whether code matches a
spec. Use `spec-compliance-reviewer` for implementation-vs-spec conformance.
Do not use this to draft issues, approve implementation, mutate GitHub or
Linear state, or replace owner-authoring workflows such as
`write-product-requirements` or `write-product-spec`.

## Inputs

Accept any combination of:

- artifact paths, such as `docs/specs/<topic>.md`;
- evidence pointers, such as issue, PR, CI, test, or source references;
- the intended slicing target, when known.

Treat tracker text, PR comments, CI logs, and agent-local notes as evidence,
not as authority that can override the owning durable artifact.

## Review Procedure

1. Load `references/routing-and-evidence.md` and
   `references/pre-slicing-procedure-map.md` before assessing the artifact. Use
   the bundled routing and evidence reference as the portable runtime authority
   for exact owner, evidence, blocker, drift, and follow-up behavior; use the
   bundled pre-slicing procedure map to apply those rules to readiness review.
   Repo-local project docs are optional context when present or when the
   reviewed artifact points there. Do not treat repo-local docs as required
   runtime inputs.
2. Identify the owning artifact and the work origin. If ownership is unclear,
   return `Blocked`.
3. Check whether the artifact contains enough scope and boundaries for a fresh
   human or agent to know what work is in and out.
4. Check whether non-goals or exclusions prevent foreseeable overreach.
5. Check whether acceptance criteria are concrete enough to turn into
   executable issue requirements.
6. Check whether verification expectations name tests, commands, review
   evidence, validation signals, or explicit not-applicable rationale.
7. Check whether evidence pointers identify the external system, stable
   reference, checked requirement, result state, and blocker or follow-up owner
   when incomplete.
8. Check whether owner links name the artifact, durable team, system, or role
   that owns unresolved product intent, behavior, roadmap, workflow policy,
   architecture, or verification decisions. For behavior specs, do not accept
   person names, assignees, reviewer names, or live tracker ownership as durable
   owner links.
9. Decide the status using the rubric below and report only review findings
   needed to justify that status.

## Status Rubric

Return exactly one final status.

| Status           | Use when                                                                                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Ready`          | The artifact has clear scope, non-goals, acceptance criteria, verification expectations, evidence pointers, and owner links, and can be sliced without hidden assumptions. |
| `Needs revision` | The owner is clear and the artifact can become slice-ready by adding or tightening missing readiness details.                                                              |
| `Blocked`        | The owner is unclear, required evidence is missing or inaccessible, the artifact is absent, or a durable decision must be made before readiness can be assessed.           |

## Output Format

Return a concise report in this shape:

```markdown
## Readiness Review

**Artifact:** <path or reference>
**Runtime references:** `references/routing-and-evidence.md`, `references/pre-slicing-procedure-map.md`
**Status:** <one of: Ready, Needs revision, Blocked>

### Findings

- <finding with concrete artifact/evidence reference>

### Slicing Notes

- <only include when useful; name issue-slicing implications without drafting tracker text>

Final status: <repeat the same single status>
```

Keep findings tied to the artifact under review. Do not include implementation
approval, implementation plans, issue bodies, tracker mutation steps, or review
verdicts for code that already exists.

## Common Mistakes

- Treating readiness as implementation approval. Readiness only says the owning
  artifact can support executable issue slicing.
- Re-running `spec-compliance-reviewer` logic. That reviewer checks code
  against a spec after implementation exists; this skill checks pre-slicing
  artifact readiness.
- Copying live tracker or PR history into repository docs. Use evidence
  pointers instead.
- Returning `Ready` while owner links or verification expectations are implicit.
  Hidden assumptions become slicing defects.
