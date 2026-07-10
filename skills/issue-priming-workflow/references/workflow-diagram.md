# Workflow Diagram — `issue-priming-workflow`

Visual illustration of the phase flow. The authoritative phase procedures
are in `SKILL.md` § Phase 1–8.

```dot
digraph priming {
  rankdir=TB;
  worktree [label="1. Worktree\nAdopt handed-off\nworktree + issue body"];
  helpers [label="Helper guards\nphase-artifacts.sh\nwrite-* helpers", shape=box];
  gate [label="2. Gate\nDedicated agent\nassesses complexity"];
  decide [label="Research?", shape=diamond];
  internal_research [label="3a. Root dispatches exactly one required internal research-agent\npolicy + ADR + code + tests"];
  external_decide [label="External criterion met?\nRoot evaluates before or after\ninternal report", shape=diamond];
  external_research [label="3b. Root dispatches zero or one conditional external research-agent"];
  research_join [label="Join all applicable direct children"];
  research_synthesize [label="Root synthesizes final research brief"];
  research_persist [label="Root persists final research brief"];
  brainstorm [label="4. Brainstorm\nInvoke skill with\nissue-body path + brief"];
  referral_check [label="Referral notice?", shape=diamond];
  cleanup [label="Cleanup worktree\nplay-branch-finish\ndiscard"];
  referral [label="STOP\nReport durable owner\nreferral notice", shape=doublecircle];
  auto_check [label="--auto?", shape=diamond];
  plan [label="5. Plan\nWrite implementation plan"];
  implement [label="6. Implement\nplay-subagent-execution"];
  stop_interactive [label="STOP\nReturn to user"];

  worktree -> helpers -> gate -> decide;
  decide -> internal_research [label="yes"];
  decide -> external_decide [label="yes"];
  decide -> brainstorm [label="no"];
  internal_research -> research_join;
  external_decide -> external_research [label="yes"];
  external_decide -> research_join [label="no"];
  external_research -> research_join;
  research_join -> research_synthesize -> research_persist;
  research_persist -> brainstorm;
  brainstorm -> referral_check;
  referral_check -> cleanup [label="yes"];
  cleanup -> referral;
  referral_check -> auto_check [label="no"];
  auto_check -> plan [label="yes"];
  auto_check -> stop_interactive [label="no"];
  plan -> implement -> review -> create_pr -> done;
  review [label="7. Branch Review\nbranch-review --fix\n+ remaining nits"];
  create_pr [label="8. Create PR\npush + gh pr create"];
  done [label="Complete\nPR ready for user", shape=doublecircle];
}
```
