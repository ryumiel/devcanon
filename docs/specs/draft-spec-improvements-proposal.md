<!-- markdownlint-disable MD030 -->

# Proposal: Enhancing AFDS Specifications for Strictness and Agent-Friendliness

**Status:** Draft
**Target Scope:** `docs/specs/` and `docs/guidelines/documentation-standard.md` (Product/Domain Specifications)

## 1. Context and Problem Statement

The current Agent-Friendly Documentation Standard (AFDS) v2 establishes a clear taxonomy for repository knowledge (`docs/specs/` for "what", `docs/arch/` for "system shape", `docs/adr/` for "why"). However, the internal structure of individual specification documents lacks the rigid constraints needed to prevent LLM hallucination and ensure deterministic implementation.

Furthermore, the relationship between a **Specification** (the durable truth) and an **Issue** (the unit of work) is often misunderstood. Treating them as a 1:1 relationship causes friction. We need to explicitly define their flexible relationship to ensure agents and humans use both systems correctly.

## 2. Un-Blurring the Lines: Specs vs. Issues

To ensure agents have exact, actionable context, we must enforce a strict separation of concerns, while acknowledging their flexible mapping.

### A. The Specification (The Durable Truth)

- **Purpose:** Defines the strict behavioral contract of the system. **It is the long-term memory of how the system works.**
- **Scope:** Broad. A spec often covers an entire domain or feature set (e.g., `docs/specs/authentication.md`). It is almost never a 1:1 map to a single issue.
- **Contents:** Product Requirements (Why/Who), Strict Boundaries (No-Gos), Breadboards (affordance flows), and Given-When-Then logic.

### B. The Issue (The Ephemeral Work Unit)

- **Purpose:** Tracks the execution of a specific task. **It is the short-term memory of the work being done.**
- **Scope:** Narrow. An issue represents a delta (a change in state).
- **Relationship to Spec:** An issue interacts with a spec in one of three ways:
  1. **Spec-Writing Issue:** The work _is_ to research and write the spec. No code is implemented.
  2. **Implementation Issue:** The work is to build a small slice of an existing spec (e.g., "Implement line 42-45 of the auth spec").
  3. **Hybrid Issue:** For small, isolated features, the issue covers both updating the spec and writing the code in the same PR.

## 3. Proposed Approaches

Below are three possible approaches for enhancing our specifications.

### Approach A: The "Shape Up" Inspired Bounded Spec

Focuses on defining strict boundaries.

- **Core Concepts:** Appetite over Estimate; Breadboarding (affordances, not visuals); Out of Bounds (No-Gos).

### Approach B: The "Behavior-Driven" (Gherkin) Logic Spec

Focuses on structured natural language.

- **Core Concepts:** Given-When-Then logic; Machine-Readable Annotations (`@test`); Checklist Verification.

### Approach C: The "Hybrid Agent-Ready" Spec (Recommended & Refined)

Combines boundary-setting, strict logic, and explicit separation of Requirements vs. Solution.

- **Core Concepts:**
  1. **Strict Boundaries Section:** Must have an "Out of Bounds" section.
  2. **Breadboard Affordances (Flow):** UI/flow requirements are described via affordances. Visuals may be linked, but the Breadboard is the source of truth.
  3. **Structured Acceptance Criteria:** Logic is defined using Given-When-Then or a strict structured list.
  4. **Architectural Handoffs:** Known "rabbit holes" must trigger an ADR (`docs/adr/`) if systemic changes are needed.
  5. **Enforceable Verification:** A standard checklist that agents must validate against using verifiable artifacts (e.g., test files).

## 4. Proposed Template Addition for `docs/specs/`

Based on Approach C, we recommend the following standard template for new specifications in `docs/specs/`:

```markdown
# [Feature or Domain Name]

## PART 1: PRODUCT REQUIREMENT (The Problem Space)

- **Persona & Problem:** [Who is this for and what pain point does it solve?]
- **Success Metric:** [How will we know this feature is successful?]
- **Appetite:** [Expected effort/budget for the current phase]

---

## PART 2: TECHNICAL SPECIFICATION (The Solution Space)

### 1. Out of Bounds (No-Gos)

- [Explicitly state what this feature will NOT do. This is a hard boundary for agents.]

### 2. Breadboard / Affordances (Flow)

- [List the UI elements, data inputs, and their connections]

### 3. Behavior & Logic (Acceptance Criteria)

- **Scenario:** [Name]
  - **Given:** [Precondition]
  - **When:** [Action]
  - **Then:** [Observable Result]

### 4. Technical Rabbit Holes & Architectural Handoffs

- [List any known architectural risks or unknowns]

### 5. Agent Verification Checklist

- [ ] Logic matches all Acceptance Criteria scenarios.
- [ ] No "Out of Bounds" features were accidentally implemented.
- [ ] Tests have been written, executed, and pass.
```

## 5. Workflow Implication: Issue Types

When interacting with tracking systems (Linear/GitHub), agents and developers must identify which type of issue they are working on:

1. **The Spec-Writing Issue:**
   - **Goal:** Create or update a document in `docs/specs/`.
   - **Agent Action:** The agent acts as an analyst. It negotiates appetite, defines "No-Gos", and writes the markdown. It does not write application code.
2. **The Implementation Issue:**
   - **Goal:** Write code to satisfy an existing spec.
   - **Agent Action:** The issue description points to a specific section of a spec (e.g., "Implement Scenario 3 from `feature-x.md`"). The agent treats the spec as a read-only contract.
3. **The Hybrid Issue (Small Scope):**
   - **Goal:** A minor enhancement that strictly does not cross architectural boundaries or introduce new technical rabbit holes.
   - **Agent Action:** The agent MUST operate sequentially. First, update the spec to reflect the new behavior—this updated spec immediately becomes the strict source of truth. Second, implement the code changes in the same PR, validating the implementation entirely against the newly modified spec constraints.
