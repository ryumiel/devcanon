# Verifying Causal Claims

When a brief asserts that X causes Y, or that doing X prevents Y, verify the claim before designing around it. This file walks through how, using the real failure that motivated the rule.

## When to verify

Look for these shapes in the brief:

- "X happens because Y."
- "Doing X prevents Y."
- "Ordering A before B fixes Z."
- "The reason this fails is Q."
- "Removing R will eliminate S."

Even if the claim sounds obvious, run the check. Briefs are written by humans whose model of the system may be incomplete.

## Worked example: PR #106 / issue #99

**The brief said:**

> `git branch -d` runs before `git pull --ff-only`, producing a spurious warning. Pulling first lets `branch -d` recognize the merge cleanly.

**The 30-second check that would have caught it:**

GitHub squash-merge creates a _new commit_ on the base branch with a different SHA than the feature branch tip. `git branch -d`'s "merged" check compares HEAD ancestry against the branch tip. After a squash-merge, the feature tip is _never_ an ancestor of HEAD, regardless of pull ordering. Reproduce locally:

```bash
git checkout -b tmp-feature
echo x > /tmp/x && git add /tmp/x && git commit -m "x"
git checkout main
git merge --squash tmp-feature && git commit -m "squash"
git branch -d tmp-feature
# → still warns, even though no pull happened (no remote involved)
```

**What the verified design would have looked like:**

The fix should have either accepted the warning as informative (it is — the local branch tip really isn't in HEAD's history), or used `git branch -D` after confirming the remote merge via `gh pr view --json state,mergeCommit`. Pull ordering was never the lever.

## How to verify, by claim shape

| Claim shape                        | First check                                                    |
| ---------------------------------- | -------------------------------------------------------------- |
| Git ordering / hook behavior       | One-shot reproduction in a throwaway repo or `/tmp` clone      |
| "File X is read by Y"              | `grep -RIn <symbol>` from repo root                            |
| "Config flag F changes behavior B" | `grep` for the flag, then read the branch it gates             |
| "Library/tool T does Z"            | Read the tool's docs or source — assume training data is stale |
| "Past commit C broke D"            | `git log -p <range>` and `git blame` on D                      |

## When you can't verify

If the check is non-trivial (multi-system, requires a staging environment, needs production data), name the unverified premise explicitly in the design doc and surface it to the user before designing around it. A flagged assumption is recoverable; a silent one isn't.
