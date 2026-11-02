# Kiki Practical Workflow Trial

Supporting validation for
[ADR-0043](../adr/adr-0043-risk-based-specialist-review.md).

## Purpose and boundaries

Try the Sol design/review, Terra implementation and focused Astra
specialist allocation on a few practical Kiki tasks. Check whether important
problems are detected, specialist attention is useful and repairs pass checks.
This is a lightweight workflow trial, not a controlled experiment, exact cost
measurement, or prerequisite to publication or installation.

The [agent spec](agents.md#codex-specialist-roles) owns allocation and
the [routing policy](../guidelines/agent-routing-and-mutation-policy.md#codex-specialist-routing)
owns escalation. Existing lifecycle and consumer contribution rules apply.
No new evaluation framework, route catalog or mandatory paired environment is
required. A trial does not itself authorize changes to Kiki or user-home installs.

## Trial procedure

1. Select a small ordinary task and a few realistic risky cases. Include design
   and implementation-review work so early consultation and later detection are
   both exercised. Freeze the task expectation before evaluating its result.
2. Explicitly request the intended models and efforts in supported sessions.
   Record whether the run uses manual role/model instructions or the implemented
   DevCanon workflow. Manual selection tests the proposed allocation; it does
   not prove packaging, dispatch integration or default configuration works.
3. Use the normal review gates and tests. Known-defect challenges may be prepared
   as red-team inputs, with expected findings held back where practical. If the
   blue session has access to the answer, disclose that limitation rather than
   claiming a blind evaluation.
4. Record a short outcome: important findings, false alarms, specialist reason
   and contribution, repair/check results and unnecessary repeated review.
   Requested model is evidence of configuration, not proof of actual execution
   when runtime telemetry is unavailable.
5. Adjust the guidance when results expose a concrete problem. Introduce stronger
   isolation, repeated comparisons or additional metrics only for a specific
   question that the practical trial cannot answer.

Use disposable Kiki worktrees for seeded defects and synthetic credentials for
security cases. Do not seed shared branches or use production secrets/services.
No separate installed workflow environment is required for a manual trial;
normal source/render/dispatch checks still verify the eventual implementation.

## Source-backed case candidates

The inspected Kiki revision is `0556a67f9efa3664910d3d7b3145c77ff33352c8` in
`ryumiel/kiki`. Recheck relevant source and tests when selecting actual tasks.
These are candidate surfaces, not completed experiments or existing defect claims.

| Case                    | Candidate evidence                                   | Expected useful outcome                                                  |
| ----------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------ |
| Ordinary cleanup        | Role-voice format tests                              | Preserve behavior and pass checks without unnecessary Astra involvement  |
| Architectural change    | Rio/Core boundary and native composition tests       | Identify the ownership guarantee and consult before a material change    |
| Cancellation regression | PCM pacer cancellation/retired-turn tests            | Detect the problem and preserve timer cleanup and retired-turn rejection |
| Security regression     | Credential-source permissions and replacement checks | Recognize the trust risk and repair or explicitly block unsafe behavior  |
| Incorrect review advice | Role-voice format contract                           | Reject unsupported advice instead of weakening validation                |

Inspected source pointers:

- [Rio boundary](https://github.com/ryumiel/kiki/blob/0556a67f9efa3664910d3d7b3145c77ff33352c8/docs/arch/rio-boundary.md).
- [Native composition tests](https://github.com/ryumiel/kiki/blob/0556a67f9efa3664910d3d7b3145c77ff33352c8/rio/src/transport/native-source.test.ts).
- [PCM pacer tests](https://github.com/ryumiel/kiki/blob/0556a67f9efa3664910d3d7b3145c77ff33352c8/rio/src/conversation/pcm-pacer.test.ts).
- [Credential tests](https://github.com/ryumiel/kiki/blob/0556a67f9efa3664910d3d7b3145c77ff33352c8/rio/src/conversation/openai-credentials.test.ts).
- [Role-voice tests](https://github.com/ryumiel/kiki/blob/0556a67f9efa3664910d3d7b3145c77ff33352c8/rio/src/conversation/role-voice.test.ts).

## Acceptance and interpretation

For each selected case, state whether the expected important problem was detected,
whether escalation had a concrete reason, and whether any repair passed relevant
checks. A correct block is detection, not a completed repair. Unsupported findings
and unnecessary escalation count against the result. Platform-skipped tests and
unavailable telemetry remain unknown rather than passing evidence.

Do not approve a task with unresolved critical findings or failed required checks.
A trial failure calls for fixing the relevant implementation or guidance through
normal workflow rules; it does not create a separate global rollout gate.

Summarize what worked, what needs adjustment and what remains uncertain. There is
no required percentage saving, dispatch-count threshold, exhaustive case matrix
or new retry budget. A few successful cases do not prove security, concurrency
safety, model independence or cross-project quality.

## Evidence and follow-up

The [proposal](https://github.com/ryumiel/devcanon/issues/875) records the
model-allocation intent and lightweight trial scope. This spec owns trial
expectations; role/routing owners retain their separate responsibilities.
Observations remain in run evidence.

The trial owner selects concrete cases and verifies their source/test premises.
The implementation owner separately proves role override propagation, rendering
and dispatch behavior. No Kiki trial or implemented-model validation is claimed
by the inspected source pointers alone.
