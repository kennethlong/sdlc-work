---
name: prime
description: Load the context for a piece of work - the Jira ticket (or spec ticket) plus the parts of the codebase it touches - and summarise it. First step of the PIV loop (prime -> plan -> execute -> validate -> report). Use at the start of a session on a ticket.
argument-hint: "[jira-key or TICKET-n]"
---

# Prime: understand the task and the terrain

CLI: `node "${CLAUDE_PLUGIN_ROOT}/bin/sdlc-atl.mjs"` (or `sdlc-atl` on PATH in other agents), written `sdlc-atl` below.

## 1. The task

- A Jira key: `sdlc-atl import $1` (if `.sdlc/tickets/$1.md` doesn't exist yet), then read the brief.
- A spec ticket (`TICKET-n`): read its section in `docs/specs/*.md`, and the PRD in `docs/prd/` if present.
- Nothing given: ask what to work on.

## 2. The codebase, scoped to the task

- Read AGENTS.md (the project rules; CLAUDE.md just imports it) and any context docs it points to for this area.
- `git ls-files` to map the layout; read the entry points and configuration for the parts the task touches.
- Find the closest existing example of what the task needs (a similar endpoint, component or test) and read it
  fully. This is the pattern the plan should mirror.
- Note the validation commands (tests, type-check, lint, build) as CI runs them.
- `git status`, and `git log --oneline -10` for the recent direction.

Stay scoped: on a large repo, reading everything wastes the context the plan will need.

## 3. Summary

A short, scannable briefing:
- **Task**: key, goal, acceptance criteria, open questions.
- **Where**: the files/modules involved, with paths.
- **Patterns to follow**: the examples found, with `file:line`.
- **Validation**: the exact commands.
- **Risks**: anything surprising (legacy paths, missing tests, conflicting conventions).

Next: `/sdlc:plan $1`.
