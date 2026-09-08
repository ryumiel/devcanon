# Watchdog operation

Use the host's supported scheduling and task controls only when scheduling has
been requested or an authorized schedule already exists. Inspect existing
schedules for this controller before creating one; update the existing match
rather than creating competing timers or controllers. Keep it attached to the
current controller where supported. Choose a cadence from the user's request
and host limits; do not invent a fixed retry budget or abandonment threshold.

Start the prompt with the target's explicit invocation instruction:

- Codex: `Use $issue-batch-coordination for this controller's existing batch.`
- Claude: `Invoke issue-batch-coordination through the Skill tool for this controller's existing batch.`

Keep Claude workflow invocation enabled; a manual-only skill setting would
block this handoff. If the host denies invocation, report the unavailable
workflow rather than substituting copied instructions.

Append this short prompt, resolving the canonical skill location and existing
controller/ledger context when the host requires explicit pointers:

> Reread the skill's canonical file and references required for this pass. Reconcile current
> user decisions and the existing ledger with live owner and provider evidence.
> Take at most the next authorized action per affected item through the skill's
> owning workflows. Stay quiet for unchanged or non-actionable state; notify on
> meaningful progress, completion, failure, or required user action. Stop the
> schedule after verified terminal completion.

The prompt selects the policy owner; it does not carry a copy of the policy or
grant permission to mutate a provider. Keep source revision or content
fingerprint evidence in existing controller-local state. Refresh and conflict
handling remain in the main skill.

During an authorized successor handoff, inspect the actual timer target and
status. Retarget the existing timer when supported. If retargeting is not
supported, pause or stop the predecessor's timer and report the supported
replacement or manual action; do not start a competing controller. Confirm
the predecessor cannot keep dispatching and the successor has acknowledged
context before successor dispatch. Do not assume task archival changes timer
state. If those controls are unavailable, hold affected successor dispatch and
report the concrete missing control.

Owner reports remain the primary signal. A wakeup with no actionable delta
does not resend approvals, continue an active owner, or repeat an unchanged
approval request. Preserve the router's monitor result in local state while
suppressing redundant user reports. Preserve notification preferences through
supported host controls; quiet prompt output does not guarantee that the host
will suppress a run notification. State any host limitation accurately.

Stop or pause the schedule through its owning host tool after the router has
verified terminal completion for the batch, or honor an explicit user stop.
Record the observed result; do not claim a timer stopped without confirmation.
If scheduling is unavailable, continue owner-driven coordination and report
that no later wakeup is armed. Do not implement a custom scheduler. A scheduled
local task still depends on its host, controller, skill bundle, and working
directory remaining available.
