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
unchanged finding `why` at the captured reviewed head. It then determines
whether a blocker has a reachable consequence or actual breach of an applicable
repository-owned obligation and independently crosses the merge gate. A real,
supported current concern below that gate is instead a Nit: the critic
actionability-checks it as `RETAIN` or `INVALID`, never promotes it, and the
retained final Nit keeps `critic: null`.

Duplicate retention comes only after those individual outcomes. Only candidates
with the same supported reachable consequence or violated obligation,
remediation, effective anchor, and compatible severity/outcome class share a
group. A group never mixes Nits with blockers or blocker verdicts; duplicate
`RETAIN` Nits may collapse, while a `VALID` blocker retains a `VALID`
representative. Ambiguity, different anchors, and carry-forward items also stay
separate.
