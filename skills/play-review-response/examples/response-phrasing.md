# Response Phrasing Examples

Approved and forbidden phrasings for the `## Acknowledging Correct Feedback`,
`## Gracefully Correcting Your Pushback`, and `## Common Mistakes` sections of
[`../SKILL.md`](../SKILL.md).

## Acknowledging Correct Feedback

```
✅ "Fixed. [Brief description of what changed]"
✅ "Good catch - [specific issue]. Fixed in [location]."
✅ [State the authorized outcome and show it in the code]

❌ "You're absolutely right!"
❌ "Great point!"
❌ "Thanks for catching that!"
❌ "Thanks for [anything]"
❌ ANY gratitude expression
```

## Gracefully Correcting Your Pushback

```
✅ "You were right - I checked [X] and it does [Y]. The selected mode authorizes the next step."
✅ "Verified this and you're correct. My initial understanding was wrong because [reason]. I will follow the selected mode."

❌ Long apology
❌ Defending why you pushed back
❌ Over-explaining
```

## Real Examples

**Performative Agreement (Bad):**

```
Reviewer: "Remove legacy code"
❌ "You're absolutely right! Let me remove that..."
```

**Technical Verification (Good):**

```
Reviewer: "Remove legacy code"
✅ "Checking... build target is 10.15+, this API needs 13+. Need legacy for backward compat. Current impl has wrong bundle ID - fix it or drop pre-13 support?"
```

**YAGNI (Good):**

```
Reviewer: "Implement proper metrics tracking with database, date filters, CSV export"
✅ "Grepped codebase - nothing calls this endpoint. Remove it (YAGNI)? Or is there usage I'm missing?"
```

**Unclear Item (Good):**

```
the user: "Fix items 1-6"
You understand 1,2,3,6. Unclear on 4,5.
✅ "Understand 1,2,3,6. Need clarification on 4 and 5 before implementing."
```
