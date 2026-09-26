# sdlc plugin

AI-native SDLC on Jira + Confluence Data Center, as portable Agent Skills plus a bundled CLI (`bin/sdlc-atl.mjs`)
and an `atlassian` MCP server (`bin/mcp-atlassian.mjs`, mcp-atlassian with its default ~35-tool set).

## Install

**Claude Code**

```
claude plugin marketplace add <path or git URL of sdlc-work>
claude plugin install sdlc@sdlc-work
```

Skills are then `/sdlc:<name>`.

**Other agents** (GitHub Copilot CLI, Copilot in VS Code, Codex, …): from the sdlc-work clone run
`node setup.mjs` (see [docs/getting-started.md](../../docs/getting-started.md)). It puts `sdlc-atl` on PATH,
copies the skills to `~/.agents/skills` as `sdlc-<name>` (Copilot CLI, VS Code and Codex all read that folder;
`$1`/`$ARGUMENTS` become named placeholders), and registers the Jira/Confluence MCP server `sdlc-atlassian` with
each tool (`copilot mcp add`, `code --add-mcp`, `codex mcp add`). `scripts/install.ps1` runs it without questions.
Copilot CLI can also load this plugin unchanged: `copilot --plugin-dir <sdlc-work>/plugins/sdlc`.

Then `/sdlc:setup` (credentials in `~/.sdlc/atlassian.env`, engine, git hook).

## Skills

| Skill | Track | What |
|---|---|---|
| `setup` | both | credentials, `.sdlc/config.json`, engine choice (gsd / piv), auto-sync hook |
| `prd` | A | draft a PRD, publish to Confluence |
| `spec` | A | PRD → ticket-sized breakdown (GSD roadmap or `docs/specs/`) → Jira stories + breakdown page |
| `ticket` | B | one Jira story: brief → escalate or work it (GSD quick task / PIV loop) |
| `rca` | B | bug root cause → `docs/rca/<KEY>.md` (with regression test + prevention rule) → Confluence + bug |
| `fix` | B | regression test first → fix → rule → sweep → validate |
| `sync` | both | Jira status + Confluence verification reports from the work's progress |
| `review` | both | whole-branch review (acceptance criteria, then bugs/security/perf/tests/standards), verified findings → PR comment, Bitbucket annotations, Jira |
| `review-fix` | both | fix findings most-severe first, each with a test; re-review |
| `pr` | both | open/update the PR (GitHub or Bitbucket DC) titled from Jira, linked from Jira |
| `prime`, `plan`, `execute`, `validate`, `report` | piv engine | the reference-style loop; artifacts named `<ticket>-<slug>.md` so progress links to Jira |

With GSD as the engine, GSD's own commands do the planning and execution (`/gsd-*`); these skills handle the
Jira/Confluence side and the tracks.

## Rebuild the bundle

From the sdlc-work repo: `npm run bundle` (commit `bin/` so installs work without `node_modules`).
