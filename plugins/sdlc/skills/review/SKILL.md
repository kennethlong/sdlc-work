---
name: review
description: Code-review the current branch against its base - first whether it does what the ticket asked, then correctness, security, performance, tests and standards - verify each finding, write .sdlc/reviews/<branch>.md, and publish it to the PR (GitHub or Bitbucket Data Center) and Jira. Use before opening or merging a PR, or when asked to review a branch.
argument-hint: "[--base <branch>]"
---

# Review: find real problems in the whole branch, prove them, report them where the team looks

CLI: `node "${CLAUDE_PLUGIN_ROOT}/bin/sdlc-atl.mjs"` (or `sdlc-atl` on PATH in other agents), written `sdlc-atl` below.
**Read-only**: don't change code in this skill. Fixing is `/sdlc:review-fix`.

## 1. Scope

```
sdlc-atl review-scope --json $ARGUMENTS
```

This gives you the base, the merge base, **every file committed on the branch** (`base...HEAD`), the commits, the
Jira key from the branch name, and any uncommitted changes. Review the committed changes. If there are
uncommitted changes, say so and ask whether to include them (commit first) or ignore them.

## 2. Context

- AGENTS.md (the project rules), and the context docs it points to for the touched areas.
- **What was asked**: the ticket brief `.sdlc/tickets/<KEY>.md`, or the GSD phase / plan, or `sdlc-atl import <KEY>`
  if neither exists. Note the acceptance criteria.
- Every changed file **in full** (not only the diff hunks), plus the tests that cover it.

## 3. Review, in two passes

**Pass 1: does it do what was asked?** Check each acceptance criterion: met, partly met, or missing? Also look for
scope creep: changes that aren't needed for the ticket.

**Pass 2: is it right?** Check for:
- **bug**: logic errors, off-by-one, wrong conditions, unhandled errors or edge cases, races, broken contracts.
- **security**: injection (SQL, command, formula, XSS), authn/authz gaps, secrets, unsafe deserialisation,
  missing input validation, data exposure.
- **performance**: N+1 queries, unbounded loops or memory, work repeated per request.
- **quality**: duplication (DRY), overly complex or long functions, poor naming, missing types, dead code: only
  where it makes the code harder to change safely, not taste. Usually medium or low.
- **tests**: behaviour changed without tests, tests that can't fail, missing edge and error cases.
- **standards**: violations of the repo's documented conventions (cite the rule), not personal taste.

**Verify every finding before you report it**: read the surrounding code, run the relevant test, or reproduce
it. Drop what you can't substantiate. A short list of real problems beats a long list of maybes. Severity:
- **critical**: security hole, data loss or corruption, or a crash on a main path.
- **high**: wrong behaviour users will hit, or an acceptance criterion not met.
- **medium**: an edge-case bug, a missing test for changed behaviour, a clear convention violation.
- **low**: minor quality or readability issues.

Judge against what the ticket and the codebase actually need. An input the requirements don't cover (another
currency, a huge number, a locale) is a bug only if the code can realistically receive it today: show the path.
Otherwise it's at most **low**, worded as a question or an option ("if X is ever needed, ..."), never a reason to
request changes. Don't send the author to `review-fix` for optional items.

## 4. Write `.sdlc/reviews/<branch with / replaced by ->.md`

```
---
base: <base from review-scope>
head: <short HEAD sha from review-scope>
verdict: changes_requested   # any critical/high | comments (only medium/low) | approved (none)
findings:
  - severity: high
    category: security
    file: src/reports/export.ts
    line: 42
    title: CSV cells are not escaped against formula injection
    detail: User-controlled values starting with = + - @ are written raw; Excel executes =HYPERLINK(...).
    suggestion: Prefix such cells with a single quote in escapeCell(); add a test per prefix.
stats:             # from review-scope: files by status (A/M/D) and the last line of "stat"
  files_added: 1
  files_modified: 3
  files_deleted: 0
  lines_added: 120
  lines_deleted: 14
---
# Code review: <branch>

<2–5 lines: overall assessment, acceptance criteria status, what's good>
```

`file` is repo-relative; `line` is the line in the new version. `category` is one of bug, security,
performance, quality, tests, standards. Write `findings: []` when there are none. The published comment shows
the stats and a count per category, so fill `stats` in from the review scope (renamed files count as modified).

## 5. Publish

If the branch has an open PR (`sdlc-atl pr --dry-run` shows `unchanged` or `would-update`):

```
sdlc-atl publish-review .sdlc/reviews/<file>.md
```

This posts (or updates in place) one review comment on the PR, adds line annotations on Bitbucket Data Center
(Code Insights), and comments the verdict on the Jira issue. Otherwise, report the findings here and suggest
`/sdlc:pr`. Then summarise for the user: the verdict, the blocking findings, and next steps (`/sdlc:review-fix`).
