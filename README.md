# sdlc-work

A toolset of AI agent skills, subagents, hooks, and scripts covering the full software development
lifecycle, built on Claude Code and portable Agent Skills. It started from
[`ai-native-starter-pack`](https://github.com/coleam00/ai-native-starter-pack).

**Status:** Atlassian bridge slices 1–2 done (client, agent tools, filing a GSD roadmap as Jira stories + Confluence breakdown). Local Jira/Confluence DC stack in `infra/`.

## Docs

- [01 – Starter pack assessment](docs/research/01-starter-pack-assessment.md): what the pack covers, defects, what to keep
- [02 – Landscape](docs/research/02-landscape.md): Spec Kit, BMAD, GSD, OpenSpec, Kiro, superpowers, and more; building blocks; gaps
- [03 – Proposal (draft)](docs/research/03-proposal.md): positioning, repo shape, language choices, roadmap, open questions

## Layout

| Path | What |
|---|---|
| `packages/atlassian` | Jira/Confluence DC client (markdown in/out) and the `sdlc-atl` CLI: `whoami`, `breakdown`, `file-breakdown --epic KEY --prd PAGE_ID [--dry-run]` |
| `scripts/mcp-atlassian.mjs` | Launches [mcp-atlassian](https://github.com/sooperset/mcp-atlassian) against the configured DC instances; wired in `.mcp.json` |
| `infra/atlassian-dc` | One-command local Jira + Confluence DC (`./dc.ps1 up`) |
| `docs/` | Research and design |

## Develop

```powershell
npm install
npm run typecheck
npm test                 # unit + live (live tests skip when no Jira/Confluence is configured)
npm run test:live        # only the integration tests against infra/atlassian-dc
```

Node 24 runs the TypeScript directly (type stripping); there is no build step.

## Design

- [01 – Atlassian bridge](docs/design/01-atlassian-bridge.md)

## Infrastructure

- [Local Jira + Confluence DC](infra/atlassian-dc/README.md): Docker stack for bridge development
