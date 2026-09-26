---
name: create-rules
description: Derive the project's rules file (AGENTS.md, which CLAUDE.md imports) and on-demand context modules from the existing codebase - conventions cited to file:line, in descending generality, with a context table and a Gotchas list. Use once per repo after /sdlc:setup (it replaces the stub AGENTS.md), or when the rules have drifted from the code.
argument-hint: "[optional focus areas]"
---

# Create rules: make the codebase's implicit conventions explicit

**One rules file for every agent.** Project rules live in `AGENTS.md` (GitHub Copilot, Codex and others read it
directly); `CLAUDE.md` only imports it with a line `@AGENTS.md`, plus any Claude-only notes. Every other sdlc
skill that adds a rule (rca, fix, review-fix, report) adds it to the file this skill shapes.

Focus areas, if given: `$ARGUMENTS`.

## 1. Read what exists first

- `AGENTS.md` and `CLAUDE.md`. `sdlc-atl init` creates a stub AGENTS.md (placeholder `<command>` lines): replace
  it. If either file has **real rules**, keep every one of them: fold them into the new structure and show the
  user any you would reword, move to a context module or drop, with the reason. Never discard a rule silently.
- `.claude/context/` (existing modules), `README`, contributor docs.

## 2. Analyse the real codebase

- `git ls-files`; read entry points, configuration, models, services, routes and the tests.
- Find the conventions actually in use: naming, error handling, logging, async style, auth, date/time handling,
  data access, how tests are written, and the exact lint / type-check / test / build commands (run them if cheap).
- Where two patterns compete (two HTTP clients, two auth systems), decide which is the forward one with the user
  and mark the other as legacy.
- Be honest about testing: if there are no unit tests, say so. Don't claim a standard the code doesn't meet.

## 3. Write a lean AGENTS.md

Use the template beside this skill (`template.md`). Rules:

- **Every rule traces to real code: cite `path:line`.** No aspirational rules the code doesn't follow.
- **Descending generality**: what applies to every task first (one-liner, naming, core patterns, commands),
  specific things last. Ultra-specific one-offs ("meeting times go through `TzTime`") belong in a context
  module, not in the global rules.
- **Keep it short** (under ~150 lines): every line is read on every task by every agent.
- Keep the mandatory **context table** and the final **Gotchas** section, even if the Gotchas list starts empty.

## 4. Extract on-demand context modules

For areas that need depth only sometimes (architecture map, a risky pattern, auth, data export, the test
harness), write `.claude/context/<topic>.md`: what it is, the pattern with a short code excerpt and `path:line`
citations, pitfalls. List each in AGENTS.md's context table with **when to load it**; that table is how every
agent (not only Claude Code) finds them. Plans cite the modules they used.

## 5. CLAUDE.md

Make sure `CLAUDE.md` contains the line `@AGENTS.md` (`sdlc-atl init` does this without overwriting). Move any
rule that applies to all agents out of CLAUDE.md into AGENTS.md; leave only Claude-specific notes there.

## 6. Confirm with the user

Show the drafted AGENTS.md and modules with the code each rule came from, plus the list of changed or dropped
existing rules. Apply their edits, then suggest committing: `docs(rules): derive AGENTS.md from the codebase`.

## Later: keeping it current

When a bug, review or report adds a rule, it goes in the section it belongs to (a general constraint under
Hard rules, a surprise under Gotchas, depth into a context module), cited and short. Re-run this skill when the
rules have drifted from the code (a new framework, a reorganised repo); that evolves the file rather than
starting over.
