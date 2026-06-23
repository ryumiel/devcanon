# `--auto` mode discipline — `issue-priming-workflow`

Anti-rationalization prose for `--auto` mode. The rules these paragraphs defend
live in `SKILL.md` (Phase 4 ambiguity stop, Phase 7 remaining-feedback
classification); this file expands the "don't talk yourself out of it"
reasoning.

## Don't launder a coin-flip into a fait accompli

**Don't launder a coin-flip into a fait accompli.** "Document the assumption in the spec and let the user override at PR review" sounds reasonable but is the same violation. Once a plan and implementation exist, the user reviewing the PR is anchoring against working code, not deciding fresh between options — that's a worse decision context, not a better one. A 30-second question now beats a re-implementation later.

## Third-party "either is fine" is not authorization

**Third-party "either is fine" is not authorization.** PM comments on the issue, teammate Slack messages, threaded discussion on the ticket — none of these count as in-session authorization for `--auto` to silently pick. They are schedule pressure dressed as consent. Surface the choice to the operator who ran `--auto`; that's the only authorization channel that counts.

## Phase 7 remaining-feedback tie-breakers

### Conservative tie-breaker

**Conservative tie-breaker.** When in doubt, treat a remaining finding as
judgment-required. False fixable classifications produce subtly wrong
branch-review fix attempts; false judgment classifications produce one extra PR
comment. Prefer the latter.

### Reclassification escape

**Reclassification escape.** If a remaining finding has multiple plausible
fixes, classify it as judgment-required and route it to PR comments. Do not
guess in issue priming, and do not create caller-owned fix commits.
