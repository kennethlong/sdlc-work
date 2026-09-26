---
name: plan
description: Write a context-rich, step-by-step implementation plan for one ticket so it can be executed in one pass - exact files, real code patterns with file:line, a check per step, and six validation levels up to manual and browser E2E. PIV loop step 2. Use after /sdlc:prime, before writing any code.
argument-hint: "<jira-key or TICKET-n>"
---

# Plan: everything the implementer needs, nothing more

No code is written in this step. The plan must let a fresh session with no memory of this conversation
implement ticket `$1` correctly on the first attempt. Context is the product: patterns, files to read,
documentation and validation commands all go in the plan.

## Where the plan goes (this links progress back to Jira)

`.claude/plans/<ticket>-<slug>.md`, where `<ticket>` is the **lower-cased** Jira key or spec ticket id, e.g.
`.claude/plans/sdlc-12-export-button.md` or `.claude/plans/ticket-2-export-ui.md`. Put a `Ticket: <KEY>` line
near the top. Create `.claude/plans/` if needed.

## 1. Understand the ticket

- Re-read the acceptance criteria and whatever `/sdlc:prime` found (`.sdlc/tickets/<KEY>.md` for Jira tickets).
- Name the core problem, who benefits, the type (new capability / enhancement / refactor / bug fix) and the
  complexity. Write or refine the user story: *As a … I want … so that …*.

## 2. Gather codebase intelligence

Use parallel searches or sub-agents where your tool has them.

- **Structure:** languages, frameworks and versions; where this feature's code lives; config and build files.
- **Patterns:** the closest existing implementation to mirror; naming, error handling, logging, config access.
  Copy **real excerpts** with `file:line` into the plan. Note anti-patterns to avoid.
- **Rules:** AGENTS.md (CLAUDE.md imports it) and the context docs it points to.
- **Dependencies:** the libraries involved, how they are wired in, their versions.
- **Tests:** framework, layout, a similar test to mirror, what "integration" means in this repo.
- **Integration points:** files to change, files to create and where, registration/routing/wiring.

If a requirement is ambiguous, or two approaches are both reasonable, **ask now** rather than guessing.

## 3. Research what you are not sure of

Official docs for any API you have not used here, with the exact section linked; known gotchas, breaking
changes between versions, security advice for the domain.

## 4. Think it through (write the answers into "Design decisions")

- How does this fit the existing architecture? What must happen first?
- What can go wrong: edge cases, races, partial failures, bad input, permissions?
- How will each acceptance criterion be proven by a test or a check?
- Performance: data sizes, hot paths, repeated calls. Security: validation, auth, secrets, injection.
- Which alternatives did you reject, and why? Is it backward compatible? Easy to change later?

## 5. Write the plan

Use `plan-template.md` in this skill's folder (it sits next to this SKILL.md). It has the full structure:
feature, context to read, **new files**, **patterns with real code**, design decisions, phases, atomic steps
(each with **Do / Pattern / Imports / Gotcha / Check**), tests, and **six validation levels**:

1. syntax and style, 2. types, 3. unit tests, 4. integration tests, 5. **manual**, 6. **E2E in a browser**
   (`/sdlc:e2e`) for user-facing changes.

Every step has a non-interactive Check command. Order steps by dependency.

## 6. Test it before handing it over

- **No Prior Knowledge test:** could someone who has never seen this codebase or this conversation implement
  the ticket from the plan alone? If they would have to search for a pattern, a file or a command, add it.
- Every reference is specific (`file:line`, `URL#section`), no "follow existing conventions".
- Every validation command runs as written, without prompts.
- Size: if the plan is well past ~700 lines or more than one focused session (about an hour) of execution,
  the ticket is too big. Say so and suggest a split.
- Give a confidence score (N/10) that it executes in one pass, and the main risks.

## Report

The plan path, a two-line summary of the approach, the complexity, the main risks, and the confidence score.
Next: `/sdlc:execute <plan path>`.
