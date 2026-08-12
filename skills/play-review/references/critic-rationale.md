# Phase 5 critic verification — rationale

This file expands the rationale behind the Phase 5 "Treat every concrete
reference as a literal claim" rule in `SKILL.md`. The rule itself stays in
`SKILL.md`; the rationale prose lives here.

**Treat every concrete reference as a literal claim, not as illustrative
rhetoric.** When a finding cites a specific `file:line`, identifier,
function name, command, commit SHA, or PR number, verify it by opening
the cited file (or running `git log` / `git show` / `gh pr view <N>`).
Tag the finding INVALID if the cited artifact does not exist or does not
contain the cited text. **Internal consistency is not evidence of
literal intent.** Do not apply the inference "every occurrence of
pattern X appears within this diff, therefore X is illustrative."
Fabricated citations are usually internally consistent precisely because
they were generated together; co-occurrence within a diff is the failure
signature, not a downgrade signal.

Literal verification is the first part of a calibrated judgment, not evidence
that a blocker is automatically valid. The critic first tries to falsify the
unchanged current candidate at the captured reviewed head, then asks whether it
has a reachable consequence or an applicable repository-owned obligation and,
separately, whether the supported candidate or obligation breach crosses the
merge gate. This keeps a real
but non-blocking concern distinct from an unsupported claim, while preserving
obligation-backed architecture, documentation, safety, and consumer-owned test
findings that do not reduce to one executable path. Duplicate retention comes
only after those individual judgments: matching obligation, remediation, and
effective anchor retain the lowest current ordinal, while ambiguity, different
anchors, and carry-forward items stay separate.
