---
name: sync
description: Push planning progress to Jira and Confluence - move filed stories and imported tickets forward (In Progress / Done) and publish verification reports. Use after planning or verifying work, or when asked for the status of the epic's tickets.
---

# Sync: make Jira and Confluence match the work

CLI: `node "${CLAUDE_PLUGIN_ROOT}/bin/sdlc-atl.mjs"` (or `sdlc-atl` on PATH in other agents), written `sdlc-atl` below.

```
sdlc-atl sync --dry-run
sdlc-atl sync
```

What it does, for Track A stories (from `file-breakdown`) and Track B tickets (from `import`):

| Work status | Jira |
|---|---|
| planned / executing / verified with gaps | In Progress |
| verified (passed) | Done, plus a "Verification: KEY …" page and a comment linking it |
| not started | unchanged |

- Issues are **never moved backwards** out of Done.
- Re-running is safe: nothing changes when nothing changed.
- Map statuses differently in `.sdlc/config.json` → `jira.transitions`, e.g. `{ "complete": "In Review" }`.

Summarise the result for the user: what moved, which reports were published (with URLs), and anything
"not filed yet" (run `/sdlc:spec`) or "no-transition" (the workflow has no path to that status; check the
project's Jira workflow or the transition map).

If `sdlc-atl hooks status` says no hook is installed, suggest `sdlc-atl hooks install` so this happens on every
relevant commit.
