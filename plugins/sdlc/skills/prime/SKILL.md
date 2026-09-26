---
name: prime
description: Load the context for a piece of work - one or more Jira tickets (or spec tickets) and any Confluence pages (specs, designs) - plus the parts of the codebase it touches, and summarise it. First step of the PIV loop (prime -> plan -> execute -> validate -> report). Use at the start of a session on a ticket.
argument-hint: "[jira-keys, TICKET-n and/or Confluence page ids or URLs, space or comma separated]"
---

# Prime: understand the task and the terrain

CLI: `node "${CLAUDE_PLUGIN_ROOT}/bin/sdlc-atl.mjs"` (or `sdlc-atl` on PATH in other agents), written `sdlc-atl` below.

## 1. The task

The arguments (`$ARGUMENTS`) may name several things, separated by spaces or commas. Load each one before
looking at code, so the codebase reading is anchored to the actual work:

- **Jira keys** (`PROJ-12`): `sdlc-atl import <KEY>` for each key whose `.sdlc/tickets/<KEY>.md` doesn't exist yet,
  then read every brief. The first key is the one being worked; the others are related context (a parent,
  a dependency, a linked bug).
- **Spec tickets** (`TICKET-n`): read the section in `docs/specs/*.md`, and the PRD in `docs/prd/` if present.
- **Confluence pages** (a numeric page id, or a page URL: take the id from `pageId=<id>` or `/pages/<id>/`):
  `sdlc-atl page pull <id> --out .sdlc/context/page-<id>.md` (per-developer: keep `.sdlc/context/` out of git),
  then read it. Treat pages as supporting context (specs, designs, decisions), not as the task itself.
- Nothing given: ask what to work on.

Start the summary with one line per item loaded, so it is clear what the work is anchored to.

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
