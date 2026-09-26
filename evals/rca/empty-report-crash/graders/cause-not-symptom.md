---
type: llm
focus: { source: file, path: docs/rca/SHOP-77.md }
---

This is a root-cause analysis of a CSV export that crashes for reports with no rows. The real cause is that
`buildRows` derives the header from `rows[0].columns`, which is undefined when there are no rows, although the
report already carries its columns in `report.schema.columns`.

PASS if the document does all of these:
- names `rows[0]` in `buildRows` (csv.ts line 14) on an empty report as the cause,
- proposes a fix that takes the header from `report.schema.columns` (or otherwise builds the header without
  needing a row), rather than only wrapping the call in a try/catch or returning an empty string,
- specifies a regression test for a report with zero rows (expected: just the header line),
- gives a prevention rule or lesson aimed at the pattern (for example: never index the first element of a
  collection that can be empty; derive structure from the schema), not just this one line.

FAIL if any of those is missing or the fix only hides the symptom.
