---
name: report
description: Write the execution report for a finished ticket - what was built, validation results, and divergences from the plan - which becomes the verdict synced to Jira and Confluence. PIV loop step 5. Use right after /sdlc:validate.
argument-hint: "[ticket key]"
---

# Report: what actually happened, for Jira and for next time

## Where it goes (this is the ticket's verdict)

`.claude/execution-reports/<ticket>-<slug>.md`, with the same `<ticket>-<slug>` as the plan (lower-cased Jira
key or spec ticket id). `sdlc-atl sync` reads its **Validation Results**: all ✓ means verified (passed), so the
Jira issue moves to Done and this report is published to Confluence; any ✗ means "needs attention".

## Template

```
# Execution Report: <title>

Ticket: <KEY>
Plan: .claude/plans/<ticket>-<slug>.md

### Meta Information
- Files added / modified: <paths>
- Lines changed: +X -Y

### Validation Results
- Lint: ✓
- Type check: ✓
- Unit tests: ✓ 43 passed
- Integration tests: ✓ 6 passed
- Build: ✓

### What Went Well
- <concrete>

### Challenges
- <what was hard, and why>

### Divergences from Plan
**<title>**: Planned: … / Actual: … / Why: … / Kind: better approach | wrong assumption | security | performance | other

### Skipped
- <item> — why

### Recommendations
- Plan skill / execute skill / AGENTS.md: <specific text to add, so the next plan is better>
```

Be honest: a ✗ is useful, a false ✓ is harmful. Commit the report with the work (the hook syncs it), or run
`/sdlc:sync`. If the recommendations include a rule, propose adding it to AGENTS.md.

Then ship it: `/sdlc:review` (branch review, published to the PR and Jira) and `/sdlc:pr` (open or update the pull request).

For the learning loop: `/sdlc:system-review <ticket>` compares the plan with this report and proposes AGENTS.md
and skill changes (worth running after any ✗, or across a few tickets).
