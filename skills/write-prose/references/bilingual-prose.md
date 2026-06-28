# Bilingual Prose

Use this reference for English/Korean bilingual drafting, translation,
adaptation, and alignment checks.

## Core Rule

Each language must read as first-class prose. Bilingual work preserves the same
source claims and terminology, but it does not force Korean to mirror English
sentence order or force English to inherit Korean document customs.

Use sentence-by-sentence translation only when the user asks for it or when the
artifact requires strict parallelism.

## Authority And Source Boundaries

Before editing, identify:

- the authoritative source language, if any;
- whether both languages are equally authoritative;
- required terminology from an owner document, product, API, style guide, or
  existing artifact;
- claims, citations, issue IDs, dates, and evidence that must appear in both
  languages;
- owner-workflow fields and sections that must remain unchanged.

If the two language surfaces conflict, do not silently reconcile by inventing a
new claim. Preserve the source-controlled wording and report the mismatch.

## Terminology Mapping

Keep an explicit mental or written map for repeated terms:

- official product, API, SDK, CLI, model, and repository names stay unchanged;
- ordinary English words should become natural Korean when no official English
  term is required;
- Korean terms should not be back-translated into vague English;
- one concept should not rotate across multiple translations in the same
  artifact;
- parenthetical English/Korean pairs are useful on first mention, but repeated
  pairs can make prose heavy.

Watch for Korean terms that are probably English residue rather than official
terminology: unnecessary `워크플로우`, `오너`, `에비던스`, `터미놀로지`,
`surface`, or administrative labels. Keep them only when they are established
domain terms, owner-workflow control words, UI labels, or official names.

## Adaptation Patterns

For Korean from English:

- move long English modifiers into shorter clauses or separate sentences;
- remove unnecessary subjects when Korean can omit them naturally;
- convert repeated prepositional structures into direct objects or predicates;
- replace abstract hype with concrete actions or decisions;
- preserve technical identifiers in backticks when the surrounding document
  uses code spans.

For English from Korean:

- make actors and actions explicit when Korean context relied on omission;
- avoid over-formal English caused by literal Korean administrative wording;
- choose direct verbs instead of noun-heavy phrasing;
- keep uncertainty and politeness markers only when they carry meaning.

For parallel bilingual sections:

- keep section labels stable when the user or owner workflow requires them;
- align facts, sequence, scope, and terminology;
- allow different sentence counts when natural prose needs it;
- avoid making one language a compressed summary unless requested.

## Bilingual Review Checks

Check both languages for:

- same factual claims and claim strength;
- same dates, numbers, units, issue IDs, and named entities;
- matching source attribution and citation scope;
- preserved protected spans;
- terminology consistency within and across languages;
- Korean that is not English-shaped;
- English that is not vague or over-formal because of Korean source structure;
- owner-workflow structure and field values left intact.

## Common Failures

- Korean keeps the English section order and grammar even after word-level
  cleanup.
- Loanwords are partly translated, leaving unexplained mixtures such as
  Korean nouns around English administrative terms.
- English polish strengthens a claim that the Korean source stated cautiously.
- A bilingual cleanup changes headings, field labels, or status values that an
  owner workflow controls.
- Issue IDs and raw evidence move from an appendix into postable prose because
  the writer tried to make both languages self-contained.

If a bilingual task requires owner decisions, terminology authority, or source
reconciliation beyond prose quality, stop and route to the owning workflow or
ask for the missing source.
