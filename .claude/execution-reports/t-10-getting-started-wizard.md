# Execution Report: Getting-started wizard

Ticket: T-10

## What was built

- `setup.mjs` (repo root) + `scripts/setup/main.mjs`, `scripts/setup/lib.mjs`: plain JavaScript, starts on Node 18+ so it can install Node 22+.
- Steps: prerequisites (Node 22+, git, uv, gh; winget/brew installs on consent, else the exact command) → AI tools (detects GitHub Copilot CLI, Copilot in VS Code, Codex, Claude Code; you pick) → install (CLI to `~/.sdlc/bin` + PATH; skills to `~/.agents/skills`, which Copilot CLI, VS Code and Codex all read; MCP server `sdlc-atlassian` via `copilot mcp add`, `code --add-mcp`, `codex mcp add`; the plugin for Claude Code) → credentials (URLs normalised, tokens hidden, each tested live, `~/.sdlc/atlassian.env` merged in place and restricted to the user) → extras (pre-fetches the MCP package to prove PyPI works through the proxy; optional GSD Core) → summary.
- TLS inspection: detects certificate errors, tests `--use-system-ca`, offers to add it to `NODE_OPTIONS`, and explains `NODE_EXTRA_CA_CERTS` / `REQUESTS_CA_BUNDLE` / `UV_NATIVE_TLS`.
- `--check` (report only), `--uninstall`, `--yes`, `--agents`, `--skip-*`, `--bin-dir`, `--skill-dirs`, `--help`.
- `scripts/install.ps1` is now a thin wrapper over the wizard.
- `sdlc-atl --help` / `help` / unknown command print usage (it crashed before).
- `docs/getting-started.md`; README quick start.

## Validation Results

- Unit tests (`npm test`): ✓ 112 passed (incl. `setup-wizard.test.ts`: env merge, masking, URL normalisation, TLS classification, skill porting for all 15 skills, pinned MCP version)
- Type check and bundle: ✓
- On this machine: ✓ install for all four tools, then `--check` all green; VS Code `mcp.json`, Codex and Copilot registrations verified
- Scripted interactive run in an isolated home against the local DC stack: ✓ Jira, Confluence, Bitbucket tokens tested; env file written with owner-only ACL; no token in the output
- Install/uninstall round trips into temporary folders (node and `install.ps1`): ✓
- Live, Jira/Confluence Cloud: ✓ 42 passed, 9 skipped (local DC stack license had expired)

## Divergences from the plan

- The reference has no installer (copy `.claude/` by hand); the deviation is recorded in the design doc under Distribution.
- Found and fixed during testing: an empty `--agents` (and `install.ps1 -Agents @()`) fell back to "all detected tools"; Windows PowerShell drops empty-string arguments, so the wrapper passes `--agents=...` as one token.
- Interactive prompts in a real terminal and the Cloud (email + API token) prompt path were exercised only through piped input and `--check`.
