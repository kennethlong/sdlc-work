# Assessment: `ai-native-starter-pack`

Source: `../ai-native-starter-pack` (upstream `github.com/coleam00/ai-native-starter-pack`, 8 commits, 41 files).
Assessed 2026-09-24.

## What it is

A workshop "AI Layer": 22 Claude Code skills, 3 subagents, 4 reference docs, 2 Python hooks, an
Atlassian `.mcp.json`, and one GitHub Actions review workflow. Its core methodology is the **PIV loop**
(Plan → Implement → Validate) plus a **system-evolution loop** (execution report → system review / RCA →
new rules). Everything is prompt-only markdown; there is no code beyond the two hooks.

Intended flow (from `diagrams/ai-native-sdlc-detailed.png`):

```
Epic (Confluence) → /spec → tickets (Jira) → /prime → /plan-feature → /execute → /validate
   → open PR → code-review (GitHub Action) → ship → /rca → updated rules ─┐
   ▲──────────────────────────────────────────────────────────────────────┘
```

## Inventory by SDLC phase

| Phase | What the pack has | Depth |
|---|---|---|
| Ideation / PRD | `create-prd` (15-section template from conversation) | ◐ template only, no elicitation/clarify pass |
| Architecture / design | 4 reference docs (vertical slice, patterns, API, frontend) | ◐ static reading; no ADRs, no design artifact |
| Onboarding / context | `create-rules` (derive CLAUDE.md + `.claude/context/`), `prime`, `prime-backend`, `prime-frontend`, `init-project` | ● strongest part of the pack |
| Slicing / tickets | `spec` (epic → PIV-sized tickets + dep graph → Confluence page + Jira issues, idempotent) | ● |
| Planning | `plan-feature` (470-line template, file:line patterns, 6 validation levels, confidence score) | ● |
| Implementation | `execute`, `end-to-end-feature`, `new-worktrees`/`merge-worktrees` (2 branches max) | ◐ no per-task subagents, no atomic commits, no plan checker |
| Validation | `validate`, `agent-browser` (E2E via Vercel agent-browser CLI) | ◐ generic; agent-browser broken on Windows (needs WSL) |
| Code review | `code-review`, `code-review-fix`, `code-reviewer` agent, `claude-review.yml` | ◐ see defects |
| Commit / PR | `commit` | ◐ no PR creation, no branch strategy |
| Security | pre_tool_use secret/rm guard; "security" bullet in code-review | ○ no SAST/SCA, threat model, security review |
| Testing strategy | sections inside plan template | ○ no test generation, coverage, mutation, flaky mgmt |
| Docs | none | ○ |
| Release / deploy | none | ○ no changelog, versioning, release notes, rollout |
| Ops / incident | `rca` + `implement-fix` (GitHub issue only) | ◐ no telemetry/Sentry intake, no runbooks |
| Learning loop | `execution-report`, `system-review`, `system-reviewer` agent | ● good idea, manual trigger |
| Observability of the agents | `post_tool_use.py` JSON log | ◐ see defects |
| Packaging / distribution | `cp -r .claude` | ○ not a plugin, no versioning |
| Evals of the skills themselves | none | ○ |

**Rough coverage: ~35–40% of a full SDLC.** It is a solid *build loop* (ticket → merged code) with a
novel learning loop, but it has nothing for security, testing depth, docs, release, deploy, or operations,
and nothing that measures whether the skills work.

## Defects & inconsistencies to fix when porting

1. **Workshop-specific content leaked into "generic" assets.**
   - `agents/code-reviewer.md` is hard-coded to Python/FastAPI/SQLAlchemy/vertical-slice (`app/core`, `uv add`).
   - `.github/workflows/claude-review.yml` prompt names a CSV formula-injection rule and a JWT rule from the demo app.
   - `validate` notes mention datetime/tenant-scoped regressions from the demo.
2. **Artifact locations are scattered and inconsistent:** `.claude/plans/`, `.claude/code-reviews/`,
   `.agents/code-reviews/agent-reviews/`, `.claude/execution-reports/`, `.claude/system-reviews/`,
   `docs/specs/`, `docs/rca/`. There is no single state directory and no index, so hand-offs between skills rely on the model
   remembering paths.
3. **Tracker split-brain:** `spec` and `prime` are Jira/Confluence-only; `rca` and `implement-fix` are GitHub-Issues-only.
   There is no tracker abstraction.
4. **Hooks:**
   - `post_tool_use.py` re-reads and rewrites one ever-growing JSON array on every tool call. Its cost grows
     quadratically with log length, there is no rotation, concurrent sessions can race each other, and it
     writes to `cwd/logs`, which subagents in worktrees change.
     Should be append-only JSONL, or OpenTelemetry.
   - `pre_tool_use.py` regexes are bypassable (`rm -r -f`, `find -delete`, `Remove-Item -Recurse`,
     `git push --force`, PowerShell tool not matched). `ENV_DUMP` blocks legitimate `process.env` in code
     *searches* too.
   - No Stop gate, no format-on-edit, no SessionStart context. The README tells users to ask their agent to write these.
   - Requires `uv` but doesn't say so in install steps.
5. **Windows unfriendliness:** `prime` says "On Linux, run tree"; worktree skills are bash-only; agent-browser
   needs WSL.
6. **No orchestration or state:** `end-to-end-feature` chains prime → plan → execute → commit but skips
   validate, review, and the execution report. There are no gates, no resume, and no fresh-context subagent per task.
7. **Review is prompt-only:** no severity-gated fix loop, no verification pass to filter false positives,
   and no diff scoping (it reviews `git diff HEAD`, not base...HEAD, so reviewing a committed branch misses everything).
8. **Worktrees capped at 2** with hard-coded ports 8124/8125.
9. **License:** README says "Free to use… make it yours", but there is **no LICENSE file**. Get explicit
   terms (or ask upstream to add MIT) before redistributing derived content as a plugin.

## What to keep (the good ideas)

- **Derive rules from the real code, cite file:line** (`create-rules`). Descending-generality CLAUDE.md
  plus on-demand `.claude/context/` modules.
- **PIV-sized tickets** (one plan of 500–700 lines, vertical slice, wave-parallel graph) with idempotent
  Jira filing.
- **Context-rich plan template** with file:line `PATTERN` references and a `VALIDATE` command per task.
- **The bug-to-rule loop:** `rca` proposes "a rule + regression test so the class can't recur", and
  `system-review` tightens rules and context from plan-vs-actual. (The "repo sweep" for other occurrences is our
  addition in `/sdlc:rca` and `/sdlc:fix`, not the reference's.)
- **"Pre = gate, post = log"** hook mental model and fail-open hooks.
- Two-session PM flow (draft the PRD, then slice in a fresh session).
