---
name: plan
description: Write a context-rich, step-by-step implementation plan for one ticket so it can be executed in one pass - exact files, patterns with file:line, and a validation command per step. PIV loop step 2. Use after /sdlc:prime, before writing any code.
argument-hint: "<jira-key or TICKET-n>"
---

# Plan: everything the implementer needs, nothing more

No code is written in this step. The plan must let a fresh session with no memory of this conversation
implement the ticket correctly on the first attempt.

## Where the plan goes (this links progress back to Jira)

`.claude/plans/<ticket>-<slug>.md`, where `<ticket>` is the **lower-cased** Jira key or spec ticket id, e.g.
`.claude/plans/sdlc-12-export-button.md` or `.claude/plans/ticket-2-export-ui.md`. Also put a `Ticket: <KEY>`
line near the top.

## Research first

- Re-read the ticket's acceptance criteria and whatever `/sdlc:prime` found.
- Find and read the existing code to mirror: naming, error handling, logging, tests. Cite `file:line`.
- Check library docs for any API you're not sure about. Link the exact section.
- If a requirement is ambiguous, or two approaches are both reasonable, **ask** now rather than guessing.

## Template

```
# Plan: <title>

Ticket: <KEY>
Goal: <one sentence>
Acceptance criteria:
- [ ] <from the ticket>

## Context to read before implementing
- `path/to/file.ts:40-85`: why it matters (pattern to mirror, integration point)
- <doc URL#section>: why

## Approach
<2–6 sentences: the design and why this one; alternatives rejected>

## Steps
### 1. CREATE|UPDATE|ADD|REMOVE `path/to/file`
- **Do:** <specific change>
- **Pattern:** `other/file.ts:12`
- **Gotcha:** <anything easy to get wrong>
- **Check:** `<command that proves this step works>`
### 2. ...

## Tests
- Unit: <cases, including edge and error cases>
- Integration/E2E: <flows, if applicable>

## Validation (the full gate, as CI runs it)
- `<lint>` / `<type-check>` / `<tests>` / `<build>`

## Risks and notes
Confidence this plan executes in one pass: N/10, and why.
```

Order the steps by dependency. Each step should be small enough to check on its own. If the plan grows past
roughly one focused session of work, the ticket is too big: say so, and suggest splitting it.

Next: `/sdlc:execute <plan path>`.
