# Execution Mode Selection Scenarios

Worked scenarios for the `## Execution Mode Selection` section of
[`../SKILL.md`](../SKILL.md). The plan-plus-executor handoff scenario stays in
`SKILL.md` because it carries the `play-planning` and `play-subagent-execution`
handoff syntax.

Inline example:

```text
Reviewer: "This CLI feedback needs a local correction."
Verification: current evidence supports the feedback and a focused check is
available.
Classification: in-scope product blocker (Writing Skills).
Mode: Inline execution.
Action: Apply the selected inline route, run the focused check, and commit as a
follow-up if the PR was already pushed or reviewed.
```

No-code feedback example:

```text
Reviewer: "This endpoint is missing validation."
Verification: current feedback-source state and current code show the endpoint
was deleted in this branch; the concern is stale.
Mode: No-code response.
Action: Prepare a concise evidence-backed disposition and keep any unclear or
unresolved thread open under the GitHub reply/refetching rules.
```

GitHub closeout exclusion example:

```text
Reviewer: "After this in-scope correction lands, reply and resolve these
threads."
Verification: the selected correction needs a plan, but GitHub replies,
refetching, resolution, posting, push, and closeout remain outside executor
tasks.
Classification: in-scope product blocker (Writing Skills).
Mode: Planned execution plus parent-owned closeout.
Action: Leave GitHub side effects in the review-response planning input as
outside executor scope. After the executor returns, this skill re-fetches
thread state, runs the Pre-Push Review Gate, replies, and resolves only
eligible threads after approval.
```
