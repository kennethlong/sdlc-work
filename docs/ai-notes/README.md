# AI notes and handoff

Working notes from building sdlc-work with Claude Code, so a fresh machine (or another agent) starts with the same
context. `memory/` is a copy of Claude Code's project memory; this page is the handoff.

## Where things stand (2026-09-28)

- **Built and tested:** the Jira/Confluence bridge (Data Center and Cloud), both tracks (PRD-first and Jira-only),
  the `gsd` and `piv` engines, PRs and AI review on Bitbucket DC and GitHub, the reference's learning layer
  (system review, create-rules, plan depth, E2E, commit, safety hooks, evals), the getting-started wizard, and
  headless "work this ticket" on Data Center (Jenkins, standalone or in-repo; or `sdlc-atl work --poll --every 5`).
- **Tests:** `npm test` (246 unit) and `npm run test:live` (52 live against the local stack); Cloud suites via
  `SDLC_LIVE_ALLOW_REMOTE=1` (see the main README).
- **Backlog:** Jira Cloud epic SCRUM-146 (kennyalanlong.atlassian.net), mirrored in [TODO.md](../../TODO.md). Done
  items have an execution report in `.claude/execution-reports/` and a verification page in Confluence (space SD).
- **Next:** the pilot at work; then team readiness (T-1..T-8, including `sdlc-atl doctor`) and the differentiators
  (D-2..D-13).

## On the work machine

1. `git clone https://github.com/kennethlong/sdlc-work.git` (private: `gh auth login` first), `cd sdlc-work`.
2. `npm install` (only needed to develop sdlc-work itself; using it needs nothing but Node).
3. `node setup.mjs`: pick your AI tools, enter the Jira, Confluence and Bitbucket URLs and tokens (tested live,
   saved to `~/.sdlc/atlassian.env`). Behind TLS inspection it offers the fix.
4. In a work repo: `/sdlc:setup` (Claude Code) or "use the sdlc-setup skill" (Copilot, Codex).
5. Start safe: a sandbox project/space or a throwaway epic, and `--dry-run` on `file-breakdown`, `sync` and `pr`.
6. Headless later: [docs/headless.md](../headless.md) (bot account, `Jenkinsfile.sdlc-work-inrepo`, a repo
   `.sdlc/config.json` with `work.jql`).

Don't point the live test suite at work instances (`npm run test:live` refuses non-local URLs unless
`SDLC_LIVE_ALLOW_REMOTE=1`). The local Docker stack (`infra/atlassian-dc`) is only for developing sdlc-work.

## Restoring the notes into Claude Code

Claude Code keeps project memory per machine, under a folder named after the project path:
`~/.claude/projects/<path with ":" "\" "/" replaced by "-">/memory/`. For a clone at `C:\Code\sdlc-work` that is
`~/.claude/projects/C--Code-sdlc-work/memory/`. Copy `memory/*.md` there:

```powershell
$dest = Join-Path $HOME ".claude\projects\$((Get-Location).Path -replace '[:\\/]', '-')\memory"
New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item docs\ai-notes\memory\*.md $dest
```

Copilot and Codex don't use this memory; for them the durable context is [AGENTS.md](../../AGENTS.md), the design
doc and this page.

## The notes

| File | What |
|---|---|
| [project-sdlc-work-goal.md](memory/project-sdlc-work-goal.md) | Goal, decisions, current state, how to test, the local stack's license quirk |
| [feedback-reference-first.md](memory/feedback-reference-first.md) | Check the reference implementation before each feature; document deviations |
| [feedback-automate-not-instruct.md](memory/feedback-automate-not-instruct.md) | Prefer one-command automation over manual checklists |

Some notes mention paths on the home machine (`C:\Code`, `D:\Code\SWG-Toolkit`); they don't apply at work.
