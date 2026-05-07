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
