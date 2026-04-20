# Gate Agent Prompt Template

Use this template when dispatching the complexity gate agent in Phase 3.

```
Agent(
  description: "Assess issue complexity for research gate",
  subagent_type: "Explore",
  model: "sonnet",
  prompt: |
    You are assessing whether a Linear issue requires multi-agent research
    before design work begins. Read the issue and scan the repository for
    existing architectural decisions.

    ## Issue

    **Title:** <ISSUE_TITLE>
    **Description:**
    <ISSUE_DESCRIPTION>

    ## Your Job

    1. Read the issue description carefully. Identify:
       - How many modules/crates are affected
       - Whether new modules or public APIs are being added
       - Whether a design choice between approaches is required

    2. Scan `docs/adr/` — list the ADR titles. Is there an existing
       decision that covers this issue's domain? If yes, note which one.

    3. Scan `AGENTS.md` and `docs/guidelines/` for rules that constrain
       this issue. Note any that apply.

    4. Check for conflicting guidance — do any existing ADRs or guidelines
       pull in different directions for this issue?

    ## Decision Criteria

    Return `RESEARCH_NEEDED` if ANY of:
    - Issue touches 2+ crates or modules
    - Issue adds a new component, crate, or public interface
    - No ADR in `docs/adr/` covers this domain
    - Existing policies/ADRs conflict for this issue
    - Issue description contains "brainstorm", "design decision", or "choose between"

    Return `SKIP_RESEARCH` if ALL of:
    - Single-module, single-file change
    - Clear precedent exists in the codebase
    - A covering ADR or guideline prescribes the approach

    ## Output Format

    One line only:

    RESEARCH_NEEDED — <reason in under 20 words>

    or

    SKIP_RESEARCH — <reason in under 20 words>

    Work from: <REPO_ROOT>
)
```

## Placeholder Reference

Replace these placeholders when dispatching:

| Placeholder           | Source                                          |
| --------------------- | ----------------------------------------------- |
| `<ISSUE_TITLE>`       | From `linear-list skill output`: `.title`       |
| `<ISSUE_DESCRIPTION>` | From `linear-list skill output`: `.description` |
| `<REPO_ROOT>`         | Current working directory                       |
