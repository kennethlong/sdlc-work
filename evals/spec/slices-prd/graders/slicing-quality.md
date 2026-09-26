---
type: llm
focus: { source: file, path: docs/specs/report-exports.md }
---

This is a ticket breakdown of a PRD with five goals (CSV export API with streaming, formula-safe cells, an export
button with progress, weekly scheduled email exports with a list/cancel page, audit logging) and a prerequisite
chore (upgrade fast-csv 4.x -> 5.x).

PASS if all of these hold:
- every PRD goal is covered by at least one ticket, and nothing out of scope (XLSX, ad-hoc queries) is added,
- each ticket is one vertical, independently testable piece of work (no ticket bundles the API, the UI and the
  scheduling together) with observable acceptance criteria,
- dependencies are sensible: the library upgrade comes first, the export API before the button and the scheduled
  exports, and no ticket depends on a later one in a cycle,
- the upgrade is its own ticket.

FAIL if any of those is violated.
