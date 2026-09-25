# Spec: Reporting Improvements

## Epic summary

Let account managers export and schedule reports without engineering help.

## Tickets

### TICKET-1 — CSV export endpoint
- **Scope:** Any saved report can be exported as CSV through the API
- **Acceptance criteria:**
  - `GET /reports/{id}/export.csv` returns the report rows as CSV
  - Cells starting with `=`, `+`, `-` or `@` are escaped against formula injection
  - Exports over 50k rows stream without timing out
- **Files touched (estimate):** `app/reports/export/service.py`, `app/reports/export/routes.py`
- **Depends on:** none

### TICKET-2 – Export UI
- Scope / acceptance criteria: Users can export from the report viewer and see progress
  - Report viewer shows an Export button for users with read access
  - Large exports show progress and a download link when done
- Files touched: `web/src/reports/ExportButton.tsx`
- Depends on: TICKET-1

### TICKET-3: Scheduled exports
- Scope: Users can schedule a report export to be emailed
- User can create a daily or weekly schedule for a saved report
- Scheduled export arrives as a CSV attachment
- Depends on: TICKET-1

## Dependency graph

TICKET-1 → TICKET-2, TICKET-1 → TICKET-3

## Suggested execution order

Wave 1: TICKET-1
Wave 2 (parallel): TICKET-2, TICKET-3
