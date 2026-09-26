---
name: commit
description: Commit the finished work as one atomic, conventional commit tagged with the Jira key (type(KEY) - summary), with an "AI Layer Changes" note when agent rules, skills or plans changed. Never commits secrets or skips hooks. Use when a piece of work is done and validated and should be committed.
argument-hint: "[message hint or Jira key]"
---

# Commit: one atomic, key-tagged commit

CLI: `node "${CLAUDE_PLUGIN_ROOT}/bin/sdlc-atl.mjs"` (or `sdlc-atl` on PATH in other agents), written `sdlc-atl` below.

## 1. See what changed

```
git status --porcelain
git diff HEAD --stat
git diff HEAD
```

Read the diff; for new files, read them. If the changes are more than one logical piece of work, say so and
commit them separately (one commit per piece), or ask the user which to commit now.

## 2. Stage deliberately, never secrets

Stage the files by name (`git add <paths>`), not `git add -A` or `git add .`. Leave out, and warn about:

- secrets and credentials: `.env` / `.env.*` (not `.env.example`), `*.pem`, `*.key`, `*.pfx`, `id_rsa*`,
  `~/.sdlc/atlassian.env` contents, anything containing a token, password or private key (look at the diff:
  `ATATT…`, `ghp_…`, `github_pat_…`, `BBDC-…`, `-----BEGIN … PRIVATE KEY-----`, `password=`);
- per-developer sdlc files: `.sdlc/tickets/`, `.sdlc/context/`, `.sdlc/sync.log`, `.sdlc/*.lock`;
- build output and editor/OS files that `.gitignore` should cover (suggest adding them).

If a secret was already committed earlier on the branch, stop and tell the user: it must be rotated, and
removing it from history is their decision.

## 3. Find the Jira key

In this order: a key given in `$ARGUMENTS`; the `key` from `node "${CLAUDE_PLUGIN_ROOT}/bin/sdlc-atl.mjs" review-scope --json` (taken from the
branch name or commits and validated: a configured `jira.projects` project, else the issue exists in Jira, so
`gsd/phase-03` or `utf-8` are not mistaken for keys); the key the work was imported or planned under
(`.sdlc/tickets/<KEY>.md`, a plan's `Ticket:` line). No key found: commit without one and say so (the PR and
sync rely on keys, so suggest adding one).

## 4. Write the message

```
<type>(<KEY>): <what changed, imperative, <= 72 chars>

<why, and the key touch points: 1-4 short lines>

AI Layer Changes:
- AGENTS.md: <rule added/changed and why>
- .claude/plans/<file>: <plan added/updated>
```

- `<type>`: `feat`, `fix`, `refactor`, `test`, `docs`, `perf`, `build`, `ci` or `chore`, matching the work.
  Without a key: `<type>: <summary>`.
- **AI Layer Changes**: only when the commit touches the files that steer agents: `AGENTS.md`, `CLAUDE.md`,
  `.github/copilot-instructions.md`, `.claude/**` (rules, context, skills, agents, plans, execution reports),
  `.agents/skills/**`, `.github/skills/**`, or `docs/rca/`. One line per file: what evolved and why. Omit the
  section otherwise.
- Follow the repo's own commit conventions if AGENTS.md or recent history (`git log --oneline -10`) shows them.

Commit with the message from a file or heredoc so line breaks survive (`git commit -F <file>`).

## 5. Hooks

Never use `--no-verify`. If a pre-commit hook fails, fix the cause, re-stage, and commit again (a new commit;
don't amend someone else's). The sdlc post-commit hook (`sdlc-atl hooks install`) runs `sdlc-atl sync` in the
background when plans, execution reports, specs or RCAs changed; its result is in `.sdlc/sync.log`.

## 6. Report

After the commit succeeds, print:

- **Commit**: hash and subject.
- **What changed**: 3-6 sentences for someone skimming the log: the problem solved and the key files.
- **AI Layer Changes**: the same list as in the message, or omit.
- Anything left out of the commit (and why), and the next step (`/sdlc:review`, then `/sdlc:pr`).

Don't push unless the user asks.
