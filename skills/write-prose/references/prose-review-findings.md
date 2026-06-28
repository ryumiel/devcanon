# Prose Review Findings

Use this reference when reporting prose-quality findings, when a rewrite is
risky, or when checking that this skill addresses known baseline failure
classes.

## Finding Format

Each finding should include:

- Severity: `blocking`, `major`, `minor`, or `suggestion`.
- Language: `English`, `Korean`, `bilingual`, or `owner-contract`.
- Rule: the violated rule or reference section.
- Evidence: a short excerpt or precise description.
- Suggested fix: a focused edit direction or local rewrite.
- Requirement type: `mandatory` or `heuristic`.
- False-positive check: why this is not quoted, source-bound, intentional,
  domain-specific, or owner-controlled.
- Reference: the bundled reference file and section.

Use findings instead of rewriting when the safe fix depends on missing source
authority, an owner workflow, or user approval.

## Severity

`blocking`:

- source fabrication;
- meaning-changing rewrite;
- protected-span drift;
- owner workflow contract mutation;
- external-system mutation attempted by a prose pass;
- publication-specific rule applied to an ordinary owner or canonical
  artifact.

`major`:

- unsupported factual or significance claim;
- mistranslation or bilingual claim mismatch;
- terminology drift;
- severe Korean grammar/register issue;
- high-impact AI-pattern cluster;
- raw evidence moved into or out of an owner-controlled section.

`minor`:

- localized clarity, punctuation, spacing, heading, or consistency problem;
- small translationese issue that does not change meaning;
- local over-polish risk.

`suggestion`:

- optional wording improvement where the current text is acceptable;
- style preference without a source or owner requirement.

## Mandatory Versus Heuristic

Mandatory findings include:

- changed facts, dates, numbers, names, issue IDs, field values, or technical
  identifiers;
- unsupported claims presented as fact;
- source fabrication or missing required evidence;
- owner contract, action mode, mutation gate, or evidence-boundary drift;
- grammar or spelling errors with high confidence.

Heuristic findings include:

- AI-like phrasing;
- translationese;
- promotional tone;
- repeated transitions;
- passive voice;
- formal vocabulary;
- title-case drift or punctuation preferences.

Do not report a heuristic pattern unless it harms accuracy, readability,
source grounding, durability, target publication style, or clusters with other
signals.

## Baseline Failure Coverage

The skill must prevent or flag these failure classes:

1. Unsupported claim preservation.
   A request to make prose sound human, natural, confident, or executive-ready
   must not preserve inflated significance or future-value claims merely
   because they sound polished. Remove, ground, or flag unsupported claims.

2. Overconfident English polish.
   A status paragraph should not become more persuasive than its evidence.
   Broad impact claims, strategic framing, and generic value claims need
   evidence or narrower wording.

3. English-shaped Korean and bilingual terminology drift.
   Bilingual cleanup must treat Korean as first-class prose and decide whether
   English-shaped terms are official terminology, owner-controlled field text,
   or translation residue.

4. Owner-structure and field-value drift.
   Support-use polishing must preserve owner-workflow headings, field labels,
   evidence appendix shape, status values, health decisions, action mode, and
   mutation semantics. Style normalization is not a reason to change them.

5. Runtime source dependency.
   The prose skill must rely on bundled references. It must not require an
   external writing vault, private source folder, or non-bundled guideline at
   runtime.

## Owner-Contract Review

For a draft produced by another workflow, check:

- Did the prose pass change action mode, health, lifecycle status, issue IDs,
  evidence placement, required fields, headings, or acceptance criteria?
- Did it move raw evidence into the postable body when the owner workflow kept
  evidence separate?
- Did it convert a dry-run into an apply action, or imply publication approval?
- Did it reinterpret a style/tone reference as a mutation target?
- Did it alter field capitalization or values that may be parsed or compared?

If yes, leave the owner-controlled text unchanged or recommend restoring it,
then report a blocking or major finding. Do not rewrite through the owner
contract.

## False-Positive Checks

Before reporting, ask:

- Is the excerpt a quote, title, product string, API name, code span, issue ID,
  path, legal text, or source-preserved phrase?
- Is the wording required by an owner workflow, template, schema, or style
  guide?
- Is the language rough because it is a meeting note, capture, or intentional
  voice?
- Is the apparent AI pattern isolated and harmless?
- Would the suggested fix change meaning, claim strength, or authority?

If the answer is yes, do not report a defect unless there is a separate,
source-grounded reason.
