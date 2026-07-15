# Workflow Diagram — `issue-priming-workflow`

Visual illustration of the phase flow. The authoritative phase procedures
are in `SKILL.md` § Phase 1–8.

```dot
digraph priming {
  rankdir=TB;
  worktree [label="1. Worktree\nAdopt handed-off\nworktree + issue body"];
  helpers [label="Helper guards\nphase-artifacts.sh\nwrite-* helpers", shape=box];
  immutable_guard [label="D1-D3 source-immutable guard\nresponse-only; zero handoffs\ncapture -> spawn -> verify -> validate -> cleanup -> apply", shape=note];
  gate [label="2. Gate\nassessor balanced/medium\nassesses complexity"];
  decide [label="Research?", shape=diamond];
  external_policy [label="Root dispatches zero or one conditional external investigator total\nImmediate and late paths are mutually exclusive\nexternal dispatch names network access", shape=note];
  immediate_external_decide [label="Immediate external criterion met before internal report?", shape=diamond];
  immediate_fork [label="Immediate path\nRoot dispatches both direct sibling leaves"];
  immediate_internal_research [label="3a. Root dispatches exactly one required internal investigator\nimmediate path: policy + ADR + code + tests"];
  immediate_external_research [label="3b. Root dispatches the sole external investigator\nimmediately as the internal sibling"];
  immediate_join [label="Join immediate internal + external siblings"];
  late_internal_research [label="3a. Root dispatches exactly one required internal investigator\nlate path: wait for policy + ADR + code + tests report"];
  late_external_decide [label="Late external criterion met after internal External Uncertainties?", shape=diamond];
  late_external_research [label="3b. Root dispatches the sole external investigator\nas a late direct sibling"];
  research_join [label="Join all applicable direct children"];
  research_outcome [label="Apply research outcome precedence", shape=diamond];
  research_required_stop [label="STOP\nRequired external blocker\nNo artifact, notice, or Phase 4", shape=doublecircle];
  research_internal_inline [label="Internal failure\nInline handoff to brainstorming\nNo artifact or notice"];
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

  worktree -> helpers -> immutable_guard -> gate -> decide;
  decide -> external_policy [label="yes"];
  decide -> brainstorm [label="no"];
  external_policy -> immediate_external_decide;
  immediate_external_decide -> immediate_fork [label="yes"];
  immediate_external_decide -> late_internal_research [label="no"];
  immediate_fork -> immediate_internal_research;
  immediate_fork -> immediate_external_research;
  immediate_internal_research -> immediate_join;
  immediate_external_research -> immediate_join;
  immediate_join -> research_join;
  late_internal_research -> late_external_decide;
  late_external_decide -> late_external_research [label="yes: one late leaf"];
  late_external_decide -> research_join [label="no"];
  late_external_research -> research_join;
  research_join -> research_outcome;
  research_outcome -> research_required_stop [label="required external failure"];
  research_outcome -> research_internal_inline [label="internal failure"];
  research_outcome -> research_synthesize [label="full success or useful external failure\nwith bounded uncertainty"];
  research_internal_inline -> brainstorm;
  research_synthesize -> research_persist;
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
