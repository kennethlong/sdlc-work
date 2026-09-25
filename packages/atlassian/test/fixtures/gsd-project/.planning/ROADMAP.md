# Roadmap: Reporting Improvements

## Overview

Let account managers export and schedule reports without engineering help.

## Phases

- [x] **Phase 1: CSV export endpoint** - Server-side CSV export of any saved report
- [ ] **Phase 2: Export UI** - Export button and progress in the report viewer
- [ ] **Phase 3: Scheduled exports** - Email a report export on a schedule

## Phase Details

### Phase 1: CSV export endpoint
**Goal**: Any saved report can be exported as CSV through the API
**Depends on**: Nothing (first phase)
**Requirements**: [EXP-01, EXP-02]
**Success Criteria** (what must be TRUE):
  1. `GET /reports/{id}/export.csv` returns the report rows as CSV
  2. Cells starting with `=`, `+`, `-` or `@` are escaped against formula injection
  3. Exports over 50k rows stream without timing out
**Plans**: 2 plans

Plans:
- [x] 01-01: Export service and streaming writer
- [x] 01-02: Route, auth and formula escaping

### Phase 2: Export UI
**Goal**: Users can export from the report viewer and see progress
**Depends on**: Phase 1
**Requirements**: [EXP-03]
**Success Criteria** (what must be TRUE):
  1. Report viewer shows an Export button for users with read access
  2. Large exports show progress and a download link when done
**Plans**: TBD

### Phase 3: Scheduled exports
**Goal**: Users can schedule a report export to be emailed
**Depends on**: Phase 1
**Requirements**: [EXP-04, EXP-05]
**Success Criteria** (what must be TRUE):
  1. User can create a daily or weekly schedule for a saved report
  2. Scheduled export arrives as a CSV attachment
**Plans**: TBD

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. CSV export endpoint | 2/2 | Complete | 2026-09-20 |
| 2. Export UI | 0/1 | In progress | - |
| 3. Scheduled exports | 0/0 | Not started | - |
