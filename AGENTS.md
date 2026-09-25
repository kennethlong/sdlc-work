# sdlc-work: agent instructions

An AI-native SDLC toolset (skills, agents, hooks, scripts) for teams on Jira + Confluence Data Center, built on
GSD Core and portable across coding agents.

## Reference-first rule

The reference implementation is [`ai-native-starter-pack`](https://github.com/coleam00/ai-native-starter-pack)
(local: `../ai-native-starter-pack`): its skills (`/spec`, `/prime`, `/plan-feature`, `/execute`, `/validate`,
`/rca`, `/system-review`), its PIV loop and its SDLC diagrams.

- **Before designing a feature, look at how the reference does it, and follow it by default.**
- **Deviating is allowed, but only with a stated reason.** Record every deviation in the design doc's
  "Deviations from the reference" table: what the reference does, what we do, and why.
- We rewrite rather than copy. The reference has no license file.

## Conventions

- **Languages:** TypeScript for libraries, CLIs and automation (Node 24 runs `.ts` directly, with no build step;
  keep syntax erasable). PowerShell 5.1-compatible scripts for Windows tooling. Python only where the
  ecosystem needs it (e.g. `uv` single-file hooks).
- **Portability:** capabilities are Agent Skills (`SKILL.md`) and MCP servers, not Claude-only features.
- **Atlassian:** target Jira/Confluence **Data Center** with PAT auth. Keep interfaces product-agnostic so Cloud
  can follow.
- **Tests:** `npm test` (unit + live). Live tests run against the local stack (`infra/atlassian-dc`,
  `./dc.ps1 up`) and clean up what they create.
- **Docs:** research in `docs/research/`, designs in `docs/design/` (each with a reference comparison).
