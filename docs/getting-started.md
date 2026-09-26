# Getting started

From zero to working in your AI coding tool of choice. About ten minutes, most of it waiting for installs.

## 1. What you need first

- **Tokens** (the wizard shows the exact page for each):
  - Jira Data Center: a Personal Access Token (profile → Personal Access Tokens).
  - Confluence Data Center: a Personal Access Token (profile → Personal Access Tokens).
  - Bitbucket Data Center, for pull requests and code review: an HTTP access token with repository write.
  - GitHub, if your repos live there: `gh auth login` (the wizard offers it).
  - Jira/Confluence Cloud instead: your Atlassian email and one API token for both.
- **An AI coding tool**: GitHub Copilot (CLI or VS Code), Codex, or Claude Code.
- If personal access tokens are disabled on your instance, ask an administrator: nothing works without them.

## 2. Run the wizard

```powershell
git clone https://github.com/kennethlong/sdlc-work.git
cd sdlc-work
node setup.mjs
```

It walks through five steps:

| Step | What happens |
|---|---|
| Prerequisites | Checks Node 22+, git, uv and gh; installs missing ones with winget (Windows) or brew (macOS) if you agree, otherwise prints the command |
| AI tools | Detects Copilot CLI, VS Code, Codex and Claude Code; you pick the ones you use |
| Install | The `sdlc-atl` CLI (`~/.sdlc/bin`, added to PATH); the skills (`~/.agents/skills`, read by Copilot CLI, VS Code and Codex); the Jira/Confluence MCP server `sdlc-atlassian` registered with each tool; the `sdlc` plugin for Claude Code |
| Credentials | Asks for URLs and tokens (hidden while typing), tests each one live, saves them to `~/.sdlc/atlassian.env` readable only by you |
| Extras | Checks the MCP server package downloads (PyPI through your proxy); offers GSD Core for the `gsd` planning engine |

Then open a **new terminal** (and restart VS Code) so PATH and settings apply. `node setup.mjs --check` re-tests
everything without changing anything; `node setup.mjs --help` lists the options (`--agents`, `--yes`, ...).

## 3. Set up a repository

In the repo, ask your tool to run the setup skill:

- Claude Code: `/sdlc:setup`
- Copilot or Codex: "use the sdlc-setup skill"

It picks the planning engine (`gsd` or `piv`), writes `.sdlc/config.json`, creates `AGENTS.md` (the project
rules every agent reads) and a `CLAUDE.md` that imports it, and installs the git hook that keeps Jira current.

## 4. Work

| You want to | Skill |
|---|---|
| Work a Jira story or task | `ticket KEY` |
| Fix a bug | `rca KEY`, then `fix KEY` |
| Plan a large feature | `prd`, then `spec` |
| Review your branch / open the PR | `review`, then `pr` |

Skill names are `/sdlc:<name>` in Claude Code and `sdlc-<name>` in Copilot and Codex.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `certificate` / `SELF_SIGNED_CERT_IN_CHAIN` / `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` | A company proxy inspects TLS. The wizard tests `--use-system-ca` and offers to add it to `NODE_OPTIONS`. Otherwise set `NODE_EXTRA_CA_CERTS` to the company root certificate (PEM), and for the MCP server also `REQUESTS_CA_BUNDLE` (same file) and `UV_NATIVE_TLS=1` |
| `uvx could not fetch mcp-atlassian` | PyPI is blocked or proxied: set `HTTPS_PROXY`, or `UV_INDEX_URL` to your internal mirror |
| `401 ... token is missing, wrong or expired` | Create a new token and re-run `node setup.mjs` |
| `403` with no message | The account lacks permission for that project/space, or tokens are disabled |
| winget is blocked | Install the listed tools through your company software portal, then re-run the wizard |
| Skills don't show up in the tool | Restart the tool; `node setup.mjs --check` shows what is installed where |
