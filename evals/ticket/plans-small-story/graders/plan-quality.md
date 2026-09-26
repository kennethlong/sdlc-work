---
type: llm
focus: trace
---

The user asked for a plan (not an implementation) for story SHOP-12: an "Export CSV" button in the report page
header that downloads `<report-name>.csv` via the existing endpoint, shows a spinner and is disabled while
downloading, and is covered by a component test.

PASS if the agent wrote a plan file that:
- names the files to change (ReportPage.tsx and a new or existing test file) and reuses `download()` from
  `src/web/api.ts` rather than inventing a new download mechanism,
- has concrete steps covering all four acceptance criteria, including the in-progress/disabled state,
- gives a validation command or check per step or at the end (lint, typecheck, tests),
and the agent did not write any source code.

Note: this eval sandbox denies writes under `.claude/`. A Write of the plan to `.claude/plans/...` that the tool
rejected counts as writing it: judge the plan from that Write call's `content`, and don't penalise the denial or
the agent reporting it.

FAIL if the plan misses an acceptance criterion, has no validation, or the agent implemented the change.
