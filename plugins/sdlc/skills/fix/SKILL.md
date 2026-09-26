---
name: fix
description: Implement a bug fix from its RCA (docs/rca/<KEY>.md) - regression test first, then the fix, the prevention rule and the sweep, validated and reported back to Jira. Use after /sdlc:rca.
argument-hint: "<jira-bug-key>"
---

# Fix: from RCA to a verified, regression-guarded fix

CLI: `node "${CLAUDE_PLUGIN_ROOT}/bin/sdlc-atl.mjs"` (or `sdlc-atl` on PATH in other agents), written `sdlc-atl` below.

## 1. Read

- `docs/rca/$1.md` in full. If it's missing, run `/sdlc:rca $1` first.
- The files it names, in full, plus their existing tests (to match the test style).
- Confirm the bug still reproduces on the current code.

## 2. Plan the fix through the engine (this is what links progress to Jira)

- **gsd**: `/gsd-quick --validate "$1: fix <summary>"`, telling the planner that the RCA's Fix Strategy,
  Prevention section and file list are the requirements.
- **piv**: write `.claude/plans/<key>-fix-<slug>.md` (lower-cased key; include a `Ticket: $1` line) with the
  steps below, then implement them.

## 3. Implement, in this order

1. **Regression test first**: write the test named in the RCA's Prevention section and watch it **fail** for
   the reason the RCA gives. A test that passes before the fix proves nothing.
2. **Fix** the root cause as the RCA describes (not a guard that hides the symptom). Keep the change minimal;
   match the surrounding code.
3. **Rule**: add the prevention rule to AGENTS.md (every agent reads it; CLAUDE.md imports it) or the relevant context doc, short and specific,
   with a pointer to the RCA. Skip only if the RCA says "none: one-off".
4. **Sweep**: fix the other occurrences the RCA lists, or file follow-up tickets for them.

## 4. Validate

Run the project's full gate (`/sdlc:validate`, or the same commands CI runs). The regression test passes, and
nothing else regressed.

## 5. Report

- **gsd**: GSD's quick-task verification writes the verdict.
- **piv**: `/sdlc:report` → `.claude/execution-reports/<key>-fix-<slug>.md`.

Commit with the key (e.g. `fix(SDLC-7): derive export headers from schema`). Progress syncs through the hook,
or run `/sdlc:sync`. If the RCA doc changed while fixing, run `sdlc-atl publish-rca $1` again.

Then ship it: `/sdlc:review` (branch review, published to the PR and Jira) and `/sdlc:pr` (open or update the pull request).
