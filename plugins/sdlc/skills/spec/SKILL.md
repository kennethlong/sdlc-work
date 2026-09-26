---
name: spec
description: Slice a PRD (Confluence page id or local docs/prd/*.md) into ticket-sized, dependency-ordered work in waves and, given an epic key, file it as Jira stories under the epic with a ticket-breakdown page under the PRD (Track A). Use after /sdlc:prd.
argument-hint: "<prd-page-id or docs/prd/file.md> [epic-key]"
---

# Spec: PRD → tickets under the epic

The bridge between the PRD and execution. The PRD is the source of truth; if the Jira epic's text disagrees
with it, **the PRD wins**. Start from a fresh session (see `/sdlc:prd`): drafting and slicing are different jobs,
and mixing them bloats the context and starts slicing before the requirements settle.

CLI: `node "${CLAUDE_PLUGIN_ROOT}/bin/sdlc-atl.mjs"` (or `sdlc-atl` on PATH in other agents), written `sdlc-atl` below.

Inputs: `$1` the PRD, as a Confluence page id (all digits) **or** a local path (e.g. `docs/prd/export.md`);
`$2` the epic key, optional. Engine: `.sdlc/config.json` "engine" (run `/sdlc:setup` if missing).

## 1. Load

- **Page id**: `sdlc-atl page pull $1 --out docs/prd/<slug>.md`, then record it: `sdlc-atl init --prd $1`.
- **Local path**: read it directly. There is no PRD page to nest the breakdown under (see step 4).
- **Epic key given**: `sdlc-atl init --epic $2`, and read the epic (`atlassian` MCP `jira_get_issue`, or the Jira UI)
  for extra context only.

Read the PRD fully: goal, user stories, acceptance criteria, out of scope.

## 2. Slice: what makes a good ticket

- **A vertical slice**: user-visible behaviour through every layer it needs, not "backend", then "frontend".
- **One plan's worth**: a ticket should produce a plan of roughly **500–700 lines** (`/sdlc:plan`) and take
  roughly **20–60 minutes** to execute. If the plan would run past ~700 lines, split the ticket.
- **Testable on its own**: 2–5 acceptance criteria taken from the PRD's stories, observable and checkable.
- **Explicit dependencies**, kept minimal: tickets in the same wave run in parallel (other developers or worktrees).
- **No shared files within a wave**: two parallel tickets that edit the same file will conflict. Make one depend on
  the other, or split the shared change into its own earlier ticket. `sdlc-atl breakdown` flags overlaps from the
  "Files touched" lines, so keep those accurate.
- **Chores** (upgrade a dependency, rename, CI) are tickets too; mark them `Type: Task` so they are filed as Tasks.

## 3. Write the breakdown in the engine's format

**gsd engine**: make GSD's phases the tickets.
- Set phase size to ticket size: `/gsd-settings` → granularity **fine**, or `.planning/config.json`
  `"granularity": "fine"`.
- Create the milestone from the PRD: `/gsd-new-milestone` (existing GSD project) or `/gsd-new-project`
  (new), giving it `docs/prd/<slug>.md` as the requirements source. Each ROADMAP phase needs a goal,
  "Depends on: Phase N" (or "Nothing"), requirement ids, and success criteria (= acceptance criteria).
- Check: `sdlc-atl breakdown` shows the phases in waves, and no cycle warnings.

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
- **Files touched (estimate):** `src/path/a.ts`, `src/path/b.ts`
- **Depends on:** none

### TICKET-2 — <title>
- **Type:** Task
...

## Dependency graph

## Suggested execution order
```

`Type:` is optional (default: the repo's issue type, normally Story). Then run `sdlc-atl breakdown` and paste
its waves into the last two sections (the dependency graph as "TICKET-2 ← TICKET-1" lines or a mermaid
graph, the order as "Wave 1 (parallel): …"). The CLI computes the waves, so the file and Jira always agree;
re-run it after changing dependencies. Fix every warning it prints (cycles, file overlaps) before filing.

## 4. File (dry run first)

**Without an epic key**, stop here: the spec in `docs/specs/` is the deliverable. Tell the user that filing
needs an epic (`sdlc-atl file-breakdown --epic KEY`), and if they want the breakdown in Confluence now,
`sdlc-atl page push docs/specs/<slug>.md --space <KEY>`.

**With an epic key**:

```
sdlc-atl file-breakdown --dry-run
```

Show the user the plan: stories to create or adopt, "blocks" links, waves, warnings. After they confirm:

```
sdlc-atl file-breakdown
```

This creates one issue per ticket under the epic (existing children with the same summary are adopted, never
duplicated), links dependencies, publishes "Spec: <epic> - Ticket Breakdown" under the PRD page (only when the
PRD came from Confluence; from a local file there is no page to nest it under), and records the mapping in
`.sdlc/atlassian.json`. It is safe to re-run after editing the plan. Commit `.sdlc/` and the plan files.

## 5. Hand off

Report the issue keys and waves, and the next step for each ticket in wave 1:
- gsd: `/gsd-discuss-phase N` → `/gsd-plan-phase N` → `/gsd-execute-phase N` → `/gsd-verify-work N`
- piv: `/sdlc:prime <KEY>` → `/sdlc:plan` → `/sdlc:execute` → `/sdlc:validate` → `/sdlc:report`

Progress flows back automatically if the hook is installed (`sdlc-atl hooks status`); otherwise run `/sdlc:sync`.
