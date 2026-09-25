---
name: setup
description: Connect a repository to Jira/Confluence for the SDLC toolset and choose its planning engine (GSD or PIV). Use once per developer machine and once per repo, or when sdlc-atl reports "not configured".
---

# Setup: connect this repo to Jira + Confluence

Run the CLI as `node "${CLAUDE_PLUGIN_ROOT}/bin/sdlc-atl.mjs"`. If that path was not substituted (agents
other than Claude Code), use `sdlc-atl` from PATH (installed by sdlc-work's `scripts/install.ps1`). Below it
is written `sdlc-atl`.

## 1. Credentials (once per machine)

The CLI and the `atlassian` MCP server read, in order: environment variables, the nearest
`infra/atlassian-dc/.env` (sdlc-work's local test stack), then `~/.sdlc/atlassian.env`.

For a real instance, create `~/.sdlc/atlassian.env`:

```
JIRA_BASE_URL=https://jira.example.com
JIRA_PAT=<personal access token>
CONFLUENCE_BASE_URL=https://confluence.example.com
CONFLUENCE_PAT=<personal access token>
```

Personal access tokens: in each product, avatar → Profile → Personal Access Tokens → Create token.
Never print token values or commit this file. Then check: `sdlc-atl whoami`.

## 2. Repo config (once per repo)

Pick the planning engine with the user:

- **gsd**: GSD Core does planning/execution (discuss → plan → execute → verify). Richer: plan checking,
  parallel waves, goal-backward verification. Needs GSD Core installed.
- **piv**: the lighter reference loop (`/sdlc:prime` → `/sdlc:plan` → `/sdlc:execute` → `/sdlc:validate` →
  `/sdlc:report`), no extra install.

```
sdlc-atl init --engine <gsd|piv> --space <CONFLUENCE_SPACE_KEY>
```

`--space` is where reports go when there is no PRD page to nest them under (Track B, RCAs). Add `--epic KEY`
and `--prd PAGE_ID` later for a Track A feature. Commit `.sdlc/config.json`; `.sdlc/atlassian.json` (the
mapping state) should be committed too, so teammates share it. `.sdlc/tickets/` and `.sdlc/sync.log` are
per-developer: suggest adding them to `.gitignore`.

## 3. Automatic sync (recommended)

```
sdlc-atl hooks install
```

Installs a git post-commit hook: any commit touching planning artifacts (`.planning/`, `.claude/plans/`,
`.claude/execution-reports/`, `docs/specs/`, `docs/rca/`) runs `sdlc-atl sync` in the background, so Jira
statuses and Confluence reports follow the work. Log: `.sdlc/sync.log`. Works for every agent and for humans.

## 4. Which track?

- **Track A (PRD-first)**: work spanning more than one ticket, or needing stakeholder review: `/sdlc:prd`, then `/sdlc:spec`.
- **Track B (Jira-only)**: one ticket's worth of work: `/sdlc:ticket KEY`; bugs: `/sdlc:rca KEY`, then `/sdlc:fix KEY`.
