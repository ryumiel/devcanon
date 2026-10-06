# Watchdog operation

Use this procedure for optional monitoring of an accepted batch.
Owner reports remain the primary continuation signal. A host schedule is a
fallback for an accepted batch, not a second controller or a source of action
authority. Do not create a custom scheduler or require a watcher agent.

## Start or change monitoring mode

Before an effect, confirm applicable retained scheduling and messaging
authority, accepted batch scope, verified controller and existing owner/host
and repository bindings, readable canonical skill policy, and the host's
supported controls for the selected mode. For a separate watcher, also validate
separate task, schedule, observation, messaging, and task-model controls.
Inspect any existing watcher and schedule against the batch,
repository, controller, known recipients, identity, target, status, retained
authority, and local notification state before reuse. Missing or ambiguous
authority, recipient, target, policy, or capability holds the affected action
with the concrete missing fact; independently authorized owner reports can
continue. Reuse a compatible monitor with its applicable model, effort, and
cadence intact, including an existing three-minute cadence or explicit model
override. Do not impose a universal interval or reset existing settings to new
watcher defaults. Honor a recorded explicit user stop: it blocks automatic
recreation unless later explicit scheduling authority supersedes it.

For requested new monitoring, default to a supported, separately authorized
watcher. Use the main skill's already-rendered `WATCHER_MODEL` in the host task's
supported model setting, unless an applicable explicit user model override
takes precedence. Effort is independently user-configured within host limits;
the model binding supplies no effort. Missing, unresolved, or rejected binding
or model control holds activation with the concrete limitation. Do not
rediscover source or ambient configuration, substitute a model, or silently
fall back to a heartbeat. Independently authorized owner-driven coordination
continues when monitoring is unavailable. Repository post-merge commands remain
separately authorized and user-configured.

Choose one active mode for the batch:

- **Coordinator heartbeat (explicitly selected):** reuse an applicable existing
  schedule, attached to the current controller where supported. Its prompt invokes
  `issue-batch-coordination`, which retains ledger and routing authority. Start
  the prompt with the target's explicit invocation instruction:
  - Codex: `Use $issue-batch-coordination for this controller's existing batch.`
  - Claude: `Invoke issue-batch-coordination through the Skill tool for this controller's existing batch.`

  Keep Claude workflow invocation enabled; a manual-only skill setting would
  block this handoff. If invocation is denied, report that unavailable workflow.
  Append this short prompt, resolving the canonical skill location and existing
  controller/ledger context when the host requires pointers:

  > Reread the skill's canonical file and references required for this pass.
  > Reconcile current user decisions and the existing ledger with live owner and
  > provider evidence. Take at most the next authorized action per affected item
  > through the skill's owning workflows. Retain routine progress and monitor
  > reports internally; notify only for an actionable decision, blocker or
  > failure, meaningful delivery milestone, verified terminal batch completion
  > without delivery, or explicit status request. Avoid duplicate or no-action
  > notices, including a terminal outcome already reported with delivery or
  > status. Stop the schedule after verified terminal completion and notice
  > selection.

- **Separate watcher:** use only when its own schedule, observation, and
  messaging effects are authorized and supported. Bind its prompt to the
  verified batch, repository, controller, known recipients, and canonical
  policy. It may observe external PR events and send authorized notifications
  to those existing recipients. It may retain local notification state only;
  it cannot approve, implement, merge, mutate a provider, create or replace an
  owner, write the batch ledger, or route work. It must report missing authority
  or capability rather than substitute coordinator behavior.

Reuse an applicable existing schedule for the selected mode after the binding
and stop checks above. To switch modes or replace a monitor, pause or retire
the old schedule through its host control and verify the observed stop before
activating the competing mode. Unknown stop status holds activation. If
inspection finds competing active monitors, reconcile them
through authorized host controls and verify one active mode before continuing.
The prompt selects canonical policy; it does not copy policy or
grant provider mutation. Keep policy revision or fingerprint evidence in the
existing controller-local state. The main skill owns refresh and conflict
handling.

## Observe and notify

A separate watcher retains only the provider event identity, observed PR head,
known recipient binding, and observed delivery outcome required to suppress
duplicate or unchanged observations. It does not infer a recipient from a PR
alone. New review comments and applicable current-head review signals go to
the known owner. Failed delivery, ambiguous ownership, or completion needing
coordination goes to the existing controller. A failed delivery remains
actionable; never record it as successful deduplication. Missing recipient or
messaging permission holds delivery with a concrete report, never a replacement
task.

Notifications carry observation context, not approval or proof that work began
or finished. Receiving owners and the coordinator reconcile current provider,
head, authority, and ledger evidence under their owning workflows before
acting. In particular, an old-head review signal cannot authorize a new-head
merge. The watcher neither repeats review requests nor promises a reviewer
response. A no-code reply leaves review-response with an explicit expected
event or authorized supported request, as described in its
[batch-reporting procedure](../../play-review-response/references/batch-reporting.md).

Owner reports remain the primary signal. A wakeup with no actionable delta
does not resend approvals, redispatch continuation to an active owner, pause
that owner for acknowledgement, or repeat an unchanged approval request.
Preserve the router's complete monitor result in controller-local state while
suppressing routine user reports. A missing gate or recovery fact still holds
the affected action and exposes any needed decision. Select user notices under
the coordinator's notification policy, including verified terminal completion
without delivery and suppression of a terminal outcome already reported with
delivery or status. Use supported host notification preferences where
available; quiet prompt output does not guarantee that the host suppresses a
run notification. State the host limitation accurately.

For delayed or conflicting observations, apply the coordinator's current-view
comparison and the router's observation recovery before deciding that a wakeup
has an actionable delta. The timer prompt does not carry a separate replay
policy.

## Recover, hand off, and stop

On recovery, verify existing controller and owner bindings, schedule identity,
target and status, and watcher notification state before continuation. Preserve
the latter across a successor handoff, including failed deliveries. Do not
reconstruct route keys, approvals, action authority, or replay facts from a
notification. Require successor acknowledgement of the transferred context.
Retarget the existing schedule when supported and verify its target. Otherwise
verify predecessor retirement before an authorized replacement. Confirm the
predecessor cannot dispatch before successor dispatch. Unknown timer control or
missing authority holds the affected transition and names the required host or
owner action. Archiving a chat does not transfer or stop its timer.

The router verifies completion of every accepted item and all separately
authorized post-merge obligations. No open PR is not completion. Preserve
required evidence before removing a worktree. Then stop or pause the schedule
through the owning host control and record the observed result separately from
chat archival. Honor an explicit user stop and retain it to prevent automatic
recreation unless superseded by later explicit scheduling authority. If the
control is unavailable, report the unresolved stop rather than claiming shutdown. If scheduling is
unavailable, continue owner-driven coordination and report that no later
wakeup is armed. A scheduled local task still depends on its host, controller,
skill bundle, and working directory remaining available.
