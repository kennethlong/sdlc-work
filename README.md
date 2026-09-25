# sdlc-work

A toolset of AI agent skills, subagents, hooks, and scripts covering the full software development
lifecycle, built on Claude Code and portable Agent Skills. It started from
[`ai-native-starter-pack`](https://github.com/coleam00/ai-native-starter-pack).

**Status:** Atlassian bridge slices 1–6 done: CLI + library, agent tools (MCP), Track A (PRD → tickets → progress back), Track B (tickets, bug RCAs), engine = GSD or reference-style PIV, and a Claude Code plugin with 12 portable skills + auto-sync git hook.

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
| `plugins/sdlc` | The Claude Code plugin: 12 skills, bundled CLI (`bin/sdlc-atl.mjs`) and MCP launcher |
| `scripts/install.ps1` | Install for other agents: CLI on PATH, skills in `~/.agents/skills` |
| `scripts/mcp-atlassian.mjs` | Launches [mcp-atlassian](https://github.com/sooperset/mcp-atlassian) against the configured DC instances; wired in `.mcp.json` |
| `infra/atlassian-dc` | One-command local Jira + Confluence DC (`./dc.ps1 up`) |
| `docs/` | Research and design |

## Develop

```powershell
npm install
npm run typecheck
npm test                 # unit + live (live tests skip when no Jira/Confluence is configured)
npm run test:live        # only the integration tests against infra/atlassian-dc
npm run bundle           # rebuild plugins/sdlc/bin after changing packages/atlassian (commit the result)
```

Node 24 runs the TypeScript directly (type stripping); there is no build step.

## Design

- [01 – Atlassian bridge](docs/design/01-atlassian-bridge.md)

## Infrastructure

- [Local Jira + Confluence DC](infra/atlassian-dc/README.md): Docker stack for bridge development
