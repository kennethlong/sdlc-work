---
name: rca
description: Root-cause a Jira bug - reproduce, trace the real cause, and write docs/rca/<KEY>.md including the regression test and the rule that stops this class of bug recurring, then publish it to Confluence and the bug. Use when given a Jira bug key, before fixing.
argument-hint: "<jira-bug-key>"
---

# RCA: understand the bug before touching it

Find the cause, not the symptom, and turn it into a lasting improvement. Every bug should leave behind a
**regression test** and, where the cause is a pattern, a **rule** in the repo's agent instructions, so the class
of bug can't come back.

CLI: `node "${CLAUDE_PLUGIN_ROOT}/bin/sdlc-atl.mjs"` (or `sdlc-atl` on PATH in other agents), written `sdlc-atl` below.

## 1. Import and read

```
sdlc-atl import $1
```

Read `.sdlc/tickets/$1.md`: the report, reproduction hints, comments.

## 2. Investigate

1. **Reproduce** it: a failing test if at all possible, otherwise exact manual steps. Record whether you
   managed to reproduce it.
2. **Locate**: search for the error text, the code paths named in the report, and recent changes
   (`git log -p --since=<when it started> -- <paths>`).
3. **Find the cause**: follow the data to the first place where it goes wrong. Ask "why" until you reach
   something the code or process could have prevented. Separate the trigger from the underlying defect.
4. **Scope**: other callers or modules with the same pattern (search for it). They are part of the fix or
   need a follow-up ticket.

Don't fix anything yet.

## 3. Write `docs/rca/$1.md`

```
# Root Cause Analysis: $1 — <title>

## Summary
- **Severity:** critical | high | medium | low, with a one-line justification
- **Reproduced:** yes/no, and how

## Problem
Expected vs actual behaviour, and the symptoms.

## Root Cause
### Analysis
What actually goes wrong and why, with `path/to/file:line` and a short code excerpt.
### Contributing factors
Missing validation, a misleading API, a test gap, and so on.

## Impact
Who and what is affected, data or security implications, other places with the same pattern.

## Proposed Fix
### Fix Strategy
The change and why it addresses the cause (not just the symptom). Alternatives considered.
### Files to change
- `path` — what changes

## Prevention
- **Regression test:** the test that fails today and passes after the fix (name and location)
- **Rule:** the instruction to add to AGENTS.md / CLAUDE.md or a context doc so agents avoid this pattern
  (write "none: one-off" only if it truly is)
- **Sweep:** other occurrences to fix now or ticket
```

## 4. Publish

```
sdlc-atl publish-rca $1
```

This creates or updates "RCA: $1 …" under "Root Cause Analyses" in the configured space, links it from the
bug, and comments the root cause and fix strategy. **Resolve any warnings it prints** (a missing regression test
or prevention rule) and publish again. Then hand over to `/sdlc:fix $1`.
