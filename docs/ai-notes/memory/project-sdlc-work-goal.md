---
name: project-sdlc-work-goal
description: sdlc-work is an AI-driven SDLC toolset (Jira/Confluence/Bitbucket DC, Copilot/Codex/Claude Code) derived from ../ai-native-starter-pack; state, decisions and how to test
metadata:
  node_type: memory
  type: project
  originSessionId: e76c5441-c4a4-4041-8e55-e3226bdb46bd
  modified: 2026-09-28T13:12:11.104Z
---

sdlc-work (started 2026-09-24; origin https://github.com/kennethlong/sdlc-work, private) is a toolset of AI SDLC skills, agents, hooks and a CLI (`sdlc-atl`) based on coleam00's ai-native-starter-pack (local ../ai-native-starter-pack; no LICENSE file, so we rewrite rather than copy). The user prefers TypeScript, with PowerShell or Python for scripting, chosen case by case.

Decisions (2026-09-24 onwards):
- Work runs Jira + Confluence + Bitbucket **Data Center** (Rovo MCP is Cloud-only, so it's out); Cloud is supported too.
- Portable from day one. The team at work uses **GitHub Copilot** mostly, with some on Codex and Claude Code. `AGENTS.md` is the single rules file; `CLAUDE.md` only imports it.
- Planning engine: `gsd` (GSD Core behind an adapter) or `piv` (the reference-style loop).
- Two tracks: PRD-first for large features, Jira-only for small work and bugs.

State on 2026-09-28: everything in docs/design/01-atlassian-bridge.md slices 1–9 is done, plus the reference gaps (F-1..F-8, D-1) and headless work (D-6, W-1..W-7). 246 unit tests and 52 live tests pass.
- `plugins/sdlc`: 19 skills, the system-reviewer agent, safety hooks and the bundled bin/ (run `npm run bundle` after changing src).
- `node setup.mjs`: the getting-started wizard, covering Copilot CLI, VS Code, Codex and Claude Code.
- Headless: `sdlc-atl work --poll [--every N]`, with Jenkins templates (standalone and in-repo multibranch). See docs/headless.md.

Next is the pilot on the user's work machine. They have Jira, Confluence and Bitbucket tokens and admin rights on a cloud Jenkins reachable over VPN; a new Jenkins build system picks up an in-repo Jenkinsfile. Also open:
- Team readiness items T-1..T-8 (T-6 `sdlc-atl doctor`), and the differentiators D-2..D-13 (SCRUM-146 epic in Jira Cloud).
- The GitHub test repo kennethlong/sdlc-work-pr-test stays until the user deletes it (the gh token lacks delete_repo). Test with SDLC_GITHUB_TEST_REPO=kennethlong/sdlc-work-pr-test.

The backlog is tracked in the user's Jira Cloud (kennyalanlong.atlassian.net: project SCRUM, space SD, epic SCRUM-146).
- In this repo, run sdlc-atl with SDLC_ATLASSIAN_ENV=user; otherwise the local-stack .env wins.
- Jira is the source of truth; TODO.md mirrors it.
- Finishing an item means an execution report in .claude/execution-reports/<id>-*.md, then `sdlc-atl sync`.

Testing:
- `npm test` runs the unit tests.
- `npm run test:live` runs against the local stack (`infra/atlassian-dc`, `./dc.ps1 up`).
- Cloud: SDLC_ATLASSIAN_ENV=user SDLC_TEST_PROJECT=SCRUM SDLC_TEST_SPACE=SD SDLC_LIVE_ALLOW_REMOTE=1 npm run test:live
- The local stack's 3-hour trial licenses can't be renewed in place. When they expire (e.g. "License limit exceeded"), run `./dc.ps1 rebuild` (about 7 minutes), then `node scripts/seed-showcase.ts` for demo data.
- Pause the Jenkins jobs during live tests: they would pick up the tests' ai-ready stories.

GSD migration (2026-09-24, user's home machine):
- Moved to @opengsd/gsd-core 1.14.0.
- Legacy copies were removed from D:\Code projects; backups are in ~/.claude-backups/gsd-legacy-*.
- D:\Code\SWG-Toolkit's .planning is ~22 GB: never cp/du it wholesale.

**Why:** the user wants a full AI SDLC toolset that the team can adopt at work.
**How to apply:** start from docs/ai-notes/README.md (the handoff) and TODO.md. Follow the reference-first rule ([[feedback-reference-first]]) and automate setup rather than writing checklists ([[feedback-automate-not-instruct]]).
