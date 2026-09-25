---
name: spec
description: Slice a Confluence PRD into ticket-sized, dependency-ordered work and file it as Jira stories under the epic, with a ticket-breakdown page under the PRD (Track A). Use after /sdlc:prd, given a PRD page id and an epic key.
argument-hint: "<prd-page-id> <epic-key>"
---

# Spec: PRD → tickets under the epic

The bridge between the PRD and execution. The PRD is the source of truth; if the Jira epic's text disagrees
with it, **the PRD wins**. Start from a fresh session (see `/sdlc:prd`).

CLI: `node "${CLAUDE_PLUGIN_ROOT}/bin/sdlc-atl.mjs"` (or `sdlc-atl` on PATH in other agents), written `sdlc-atl` below.

Inputs: `$1` PRD page id, `$2` epic key. Engine: `.sdlc/config.json` "engine" (run `/sdlc:setup` if missing).

## 1. Load

```
sdlc-atl page pull $1 --out docs/prd/<slug>.md
sdlc-atl init --epic $2 --prd $1
```

Read the PRD fully. Read the epic too (`atlassian` MCP `jira_get_issue`, or the Jira UI) for extra context only.

## 2. Slice: what makes a good ticket

- **A vertical slice**: user-visible behaviour through every layer it needs, not "backend", then "frontend".
- **One plan's worth**: about one focused implementation session. Split anything bigger.
- **Testable on its own**: 2–5 acceptance criteria taken from the PRD's stories, observable and checkable.
- **Explicit dependencies**, kept minimal: independent tickets can run in parallel.

## 3. Write the breakdown in the engine's format

**gsd engine**: make GSD's phases the tickets.
- Set phase size to ticket size: `/gsd-settings` → granularity **fine**, or `.planning/config.json`
  `"granularity": "fine"`.
- Create the milestone from the PRD: `/gsd-new-milestone` (existing GSD project) or `/gsd-new-project`
  (new), giving it `docs/prd/<slug>.md` as the requirements source. Each ROADMAP phase needs a goal,
  "Depends on: Phase N" (or "Nothing"), requirement ids, and success criteria (= acceptance criteria).
- Check: `sdlc-atl breakdown` shows the phases in waves and no cycle warnings.

**piv engine**: write `docs/specs/<slug>.md`:

```
# Spec: <Epic name>

## Epic summary

<2–3 lines>

## Tickets

### TICKET-1 — <title>
- **Scope:** <one sentence>
- **Acceptance criteria:**
  - <observable, testable statement>
- **Files touched (estimate):** <paths>
- **Depends on:** none

### TICKET-2 — <title>
...
```

Check: `sdlc-atl breakdown` lists every ticket in the right waves.

## 4. File (dry run first)

```
sdlc-atl file-breakdown --dry-run
```

Show the user the plan: stories to create or adopt, "blocks" links, waves. After they confirm:

```
sdlc-atl file-breakdown
```

This creates one story per ticket under the epic (existing children with the same summary are adopted, never
duplicated), links dependencies, publishes "Spec: <epic> - Ticket Breakdown" under the PRD, and records the
mapping in `.sdlc/atlassian.json`. It is safe to re-run after editing the plan. Commit `.sdlc/` and the plan
files.

## 5. Hand off

Report the story keys and waves, and the next step for each ticket in wave 1:
- gsd: `/gsd-discuss-phase N` → `/gsd-plan-phase N` → `/gsd-execute-phase N` → `/gsd-verify-work N`
- piv: `/sdlc:prime <KEY>` → `/sdlc:plan` → `/sdlc:execute` → `/sdlc:validate` → `/sdlc:report`

Progress flows back automatically if the hook is installed (`sdlc-atl hooks status`); otherwise run `/sdlc:sync`.
