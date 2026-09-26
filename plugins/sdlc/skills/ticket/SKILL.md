---
name: ticket
description: Work a single Jira story or task (Track B) - import it as a brief, confirm it is one ticket's worth of work, then run it through the repo's engine (GSD quick task or the PIV loop). Use when given a Jira key for a small feature or task. For bugs use /sdlc:rca first.
argument-hint: "<jira-key>"
---

# Ticket: one Jira issue, start to finish

CLI: `node "${CLAUDE_PLUGIN_ROOT}/bin/sdlc-atl.mjs"` (or `sdlc-atl` on PATH in other agents), written `sdlc-atl` below.

## 1. Import

```
sdlc-atl import $1
```

This writes `.sdlc/tickets/$1.md`: summary, description, acceptance criteria, recent comments, and the exact
next steps for this repo's engine. Read it fully. If it is a **Bug**, stop and use `/sdlc:rca $1` instead.

## 2. Is it really one ticket?

It fits Track B when it is one vertical change that one plan can cover. If it isn't (several independent
parts, needs stakeholder decisions, touches many subsystems), don't force it:

```
sdlc-atl escalate $1 --epic <EPIC>
```

Then suggest `/sdlc:prd` for the feature. If acceptance criteria are missing, propose some and get the
user's agreement before planning; the brief says so when there are none.

## 3. Do the work: follow the brief's "Next steps"

- **gsd**: start a quick task whose description **begins with the key**, so the task links to the ticket:
  `/gsd-quick --validate "$1: <summary>"`, and point the planner at `.sdlc/tickets/$1.md` for the acceptance
  criteria and context.
- **piv**: `/sdlc:prime $1` → `/sdlc:plan $1` → `/sdlc:execute` → `/sdlc:validate` → `/sdlc:report`.
  Artifact names start with the lower-cased key (`.claude/plans/<key>-<slug>.md`), which is how progress is
  linked back. After planning, summarise the plan and get the user's go-ahead before executing, unless they
  asked for a hands-off run.

## 4. Report back

Commit the work and the planning artifacts with `/sdlc:commit` (key in the message, e.g.
`feat(SDLC-12): export button`).
With the hook installed, the Jira issue moves to In Progress when planned and to Done when verified, and the
verification report is published to Confluence. Without the hook, run `/sdlc:sync`.

Then ship it: `/sdlc:review` (branch review, published to the PR and Jira) and `/sdlc:pr` (open or update the pull request).
