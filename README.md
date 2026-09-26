# sdlc-work

A toolset of AI agent skills, subagents, hooks, and scripts covering the full software development
lifecycle, built on Claude Code and portable Agent Skills. It started from
[`ai-native-starter-pack`](https://github.com/coleam00/ai-native-starter-pack).

**Status:** slices 1–8 done: Jira/Confluence (DC + Cloud, verified live), Track A/B, GSD or PIV engine, a Claude Code plugin with 15 portable skills + auto-sync git hook, and PR + code review on GitHub and Bitbucket Data Center.

## Quick start

```powershell
git clone https://github.com/kennethlong/sdlc-work.git
cd sdlc-work
node setup.mjs          # the getting-started wizard (safe to re-run; --check only reports)
```

The wizard asks which AI tools you use (GitHub Copilot CLI, Copilot in VS Code, Codex, Claude Code), checks
and installs the prerequisites (Node 22+, git, uv, gh), installs the skills and the Jira/Confluence MCP server
for each tool (the plugin for Claude Code), and collects and tests your Jira, Confluence and Bitbucket tokens.
Then, in a repo, run the setup skill: `/sdlc:setup` in Claude Code, or ask Copilot or Codex to "use the
sdlc-setup skill". Details: [docs/getting-started.md](docs/getting-started.md).

## Docs

- [TODO](TODO.md): the ranked work list from the crew review

- [01 – Starter pack assessment](docs/research/01-starter-pack-assessment.md): what the pack covers, defects, what to keep
- [02 – Landscape](docs/research/02-landscape.md): Spec Kit, BMAD, GSD, OpenSpec, Kiro, superpowers, and more; building blocks; gaps
- [04 – Crew review](docs/research/04-crew-review.md): four-lens review vs the reference, bugs, ranked recommendations
- [03 – Proposal (draft)](docs/research/03-proposal.md): positioning, repo shape, language choices, roadmap, open questions

## Layout

| Path | What |
|---|---|
| `packages/atlassian` | Jira/Confluence client (Data Center and Cloud, markdown in/out), git hosts (GitHub, Bitbucket DC) and the `sdlc-atl` CLI (`sdlc-atl --help`: breakdown, file-breakdown, import, publish-rca, escalate, review-scope, pr, publish-review, sync, page, hooks, init, whoami) |
| `plugins/sdlc` | The Claude Code plugin: 19 skills, the `system-reviewer` agent, safety hooks, bundled CLI (`bin/sdlc-atl.mjs`) and MCP launcher |
| `setup.mjs`, `scripts/setup/` | Getting-started wizard: prerequisites, skills + MCP per AI tool, credentials ([docs/getting-started.md](docs/getting-started.md)); `scripts/install.ps1` runs it without questions |
| `evals/` | Plugin evals for spec, ticket, rca and review (`claude plugin eval . --allow-tools Write`); CI in `.github/workflows/plugin-evals.yml` |
| `scripts/mcp-atlassian.mjs` | Launches [mcp-atlassian](https://github.com/sooperset/mcp-atlassian) against the configured DC instances; wired in `.mcp.json` |
| `infra/atlassian-dc` | One-command local Jira + Confluence + Bitbucket DC (`./dc.ps1 up`) |
| `templates/ci` | CI review templates: GitHub Actions, Jenkins for Bitbucket DC (untested) |
| `docs/` | Research and design |

## Develop

```powershell
npm install
npm run typecheck
npm test                 # unit tests only (never touches Jira/Confluence)
npm run test:live        # integration tests against the local stack (infra/atlassian-dc); refuses other URLs
# live suites against another instance (e.g. the Cloud test site): opt in explicitly
#   $env:SDLC_ATLASSIAN_ENV='user'; $env:SDLC_TEST_PROJECT='SCRUM'; $env:SDLC_TEST_SPACE='SD'; $env:SDLC_LIVE_ALLOW_REMOTE='1'; npm run test:live
# live GitHub PR/review suite (opt-in, needs an existing throwaway repo + gh login):
#   $env:SDLC_GITHUB_TEST_REPO='owner/repo'; npm run test:live
npm run bundle           # rebuild plugins/sdlc/bin after changing packages/atlassian (commit the result)
```

Node 24 runs the TypeScript directly (type stripping); there is no build step.

## Design

- [01 – Atlassian bridge](docs/design/01-atlassian-bridge.md)

## Infrastructure

- [Local Jira + Confluence DC](infra/atlassian-dc/README.md): Docker stack for bridge development
