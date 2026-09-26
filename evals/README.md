# Plugin evals

Behavioural tests for the `sdlc` skills, run with `claude plugin eval`. Each case gives Claude a realistic
request with everything it needs inline (ticket, diff, bug report, PRD: no live Jira, git or MCP server), runs it
**with** the plugin and **without** it, and grades what was produced. The difference (Δ) is what the skills add.

| Suite | Case | Checks |
|---|---|---|
| review | `flags-sql-injection` | Review file at `.sdlc/reviews/<branch>.md` with `changes_requested`, a critical/high security finding cited to the right line; reply names SQL injection, the unmet 50-row cap and missing tests |
| review | `approves-clean-change` | Correct, tested change: `approved`/`comments`, no critical/high findings, nothing invented |
| rca | `empty-report-crash` | `docs/rca/SHOP-77.md` in the RCA template, cites `csv.ts:14`, fixes the cause (header from the schema) not the symptom, regression test + prevention rule; no code changed |
| ticket | `plans-small-story` | Plan at `.claude/plans/shop-12-*.md` with a `Ticket: SHOP-12` line, all acceptance criteria and validation; nothing implemented |
| ticket | `escalates-epic-sized` | An epic disguised as a story is escalated (PRD / epic), not planned |
| spec | `slices-prd` | `docs/specs/report-exports.md` in the piv format (`### TICKET-n`, acceptance criteria, depends on), 5+ tickets, the library upgrade as a `Type: Task`, sensible dependencies |

`tool_used: Skill` graders show whether the skill fired; they don't count toward the score in two-arm runs.

## Run

From the repo root (the plugin must sit under the directory you target, so target `.`, not the case file):

```bash
claude plugin eval . --allow-tools Write --no-publish                    # all cases, 3 runs per arm
claude plugin eval . --case flags-sql-injection --runs 1 --allow-tools Write --no-publish
claude plugin eval . --tag smoke --runs 1 --ablation none --allow-tools Write   # cheap check while editing skills
```

Writes under `.claude/` are denied inside the eval sandbox even with `--allow-tools Write` (Claude Code protects
that folder in non-interactive runs), so plan cases grade the `Write` call's path instead of the file on disk.

`--allow-tools Write` is required: the skills write their review, RCA, plan and spec files. Bash is not granted
(native Windows has no sandbox for it, and the cases don't need it). Results go to `evals/results/` (ignored).

Cost: about $0.15 per agent run with the default model, plus small judge calls. One case with and without the
plugin, one run each: about $0.30 and a minute. The whole suite at `--runs 2`: about $4.

CI: `.github/workflows/plugin-evals.yml` runs on demand and on PRs that touch skills or evals, once an
`ANTHROPIC_API_KEY` repository secret exists.

## First result

`flags-sql-injection`, one run per arm (2026-09-26): with the plugin **1.00**, without **0.25**, Δ **+0.75**,
$0.30, 67 s. Both arms spotted the injection; only the plugin produced the structured review file that
`sdlc-atl publish-review` posts to the PR and Jira.
