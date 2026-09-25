# sdlc-work

A toolset of AI agent skills, subagents, hooks, and scripts covering the full software development
lifecycle, built on Claude Code and portable Agent Skills. It started from
[`ai-native-starter-pack`](https://github.com/coleam00/ai-native-starter-pack).

**Status:** slices 1–8 done: Jira/Confluence (DC + Cloud, verified live), Track A/B, GSD or PIV engine, a Claude Code plugin with 15 portable skills + auto-sync git hook, and PR + code review on GitHub and Bitbucket Data Center.

## Quick start

```powershell
# Claude Code
claude plugin marketplace add C:Codesdlc-work
claude plugin install sdlc@sdlc-work
# other agents (Codex, Gemini CLI, ...): CLI on PATH + skills in ~/.agents/skills
./scripts/install.ps1
```

Then run `/sdlc:setup` in a repo. See [plugins/sdlc/README.md](plugins/sdlc/README.md).

## Docs

- [01 – Starter pack assessment](docs/research/01-starter-pack-assessment.md): what the pack covers, defects, what to keep
- [02 – Landscape](docs/research/02-landscape.md): Spec Kit, BMAD, GSD, OpenSpec, Kiro, superpowers, and more; building blocks; gaps
- [03 – Proposal (draft)](docs/research/03-proposal.md): positioning, repo shape, language choices, roadmap, open questions

## Layout

| Path | What |
|---|---|
| `packages/atlassian` | Jira/Confluence DC client (markdown in/out) and the `sdlc-atl` CLI: `whoami`, `breakdown`, `file-breakdown --epic KEY --prd PAGE_ID [--dry-run]`, `sync [--dry-run]`, Track B: `import KEY`, `publish-rca KEY`, `escalate KEY --epic E` |
| `plugins/sdlc` | The Claude Code plugin: 15 skills, bundled CLI (`bin/sdlc-atl.mjs`) and MCP launcher |
| `scripts/install.ps1` | Install for other agents: CLI on PATH, skills in `~/.agents/skills` |
| `scripts/mcp-atlassian.mjs` | Launches [mcp-atlassian](https://github.com/sooperset/mcp-atlassian) against the configured DC instances; wired in `.mcp.json` |
| `infra/atlassian-dc` | One-command local Jira + Confluence + Bitbucket DC (`./dc.ps1 up`) |
| `templates/ci` | CI review templates: GitHub Actions, Jenkins for Bitbucket DC (untested) |
| `docs/` | Research and design |

## Develop

```powershell
npm install
npm run typecheck
npm test                 # unit + live (live tests skip when no Jira/Confluence is configured)
npm run test:live        # only the integration tests against infra/atlassian-dc
# live suites against your own instance (e.g. Cloud) instead of the local stack:
#   $env:SDLC_ATLASSIAN_ENV='user'; $env:SDLC_TEST_PROJECT='SCRUM'; $env:SDLC_TEST_SPACE='SD'; npm run test:live
# live GitHub PR/review suite (opt-in, needs an existing throwaway repo + gh login):
#   $env:SDLC_GITHUB_TEST_REPO='owner/repo'; npm run test:live
npm run bundle           # rebuild plugins/sdlc/bin after changing packages/atlassian (commit the result)
```

Node 24 runs the TypeScript directly (type stripping); there is no build step.

## Design

- [01 – Atlassian bridge](docs/design/01-atlassian-bridge.md)

## Infrastructure

- [Local Jira + Confluence DC](infra/atlassian-dc/README.md): Docker stack for bridge development
