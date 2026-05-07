# Phase 4 sub-check worked examples — `play-review`

These are the worked examples and illustrative scenarios that anchor each Phase 4
sub-check. The procedure, bounding rule, and disposition for each sub-check stay
in `SKILL.md` because they're per-turn instruction; the examples are illustrative
and live here to keep `SKILL.md` lean.

## Sub-check 1: Substitution audit — worked example

Worked example: a diff replaces `git branch -d` with `git branch -D` to silence a spurious squash-merge warning. The OLD primitive's safety properties include rejecting deletion when the branch has unmerged commits relative to its upstream and HEAD. The NEW primitive (`-D`) accepts unconditionally, and the diff adds no surrounding guard. Verdict: SILENTLY DROPS the unmerged-commit rejection — `Blocking | Safety`, with the recommendation to add a tip-equality check (local tip == PR head OID) before `-D` runs.

## Sub-check 2: Documented-behavior verification — worked example

Worked example: a diff adds a `gh api repos/{owner}/{repo}/pulls/<N>/reviews` invocation that mixes `-f commit_id=...`, `-f event=...`, `-f body=...` with `--input <file>`. The Correctness agent reads `gh api --help` and identifies that when `--input` is supplied, sibling `-f` flags become URL query parameters, not body fields — so `commit_id`, `event`, and `body` are silently dropped from the POST body. Verdict: DOCUMENTED-BEHAVIOR MISMATCH — `Blocking | Contracts`, with the recommendation to build the entire payload inside `jq -n` so all fields land in the JSON body.

## Docs Sub-check A: Within-document identifier drift — illustrative scenario

Illustrative scenario: a single `.md` file describes a worktree-cleanup procedure where the prose narrates "`git worktree prune` removes the directory" while the adjacent code block invokes `git worktree remove <path>`. The two identifiers diverged across review rounds — code was updated; prose was not. Sub-check A flags this as `Blocking | Documentation`, with the recommendation "the code block is canonical; rewrite prose to match."

## Docs Sub-check B: Cross-document identifier drift — illustrative scenario

Illustrative scenario (hypothetical): suppose a diff to one skill adds prose explicitly calling out that `gh api -f <field>=<value>` combined with `--input <file>` is broken because `-f` arguments become URL query parameters when `--input` is supplied. Sub-check B greps the corpus for the broken pattern. Any unchanged sibling files still demonstrating it would each be flagged as a blocking, out-of-diff finding.
