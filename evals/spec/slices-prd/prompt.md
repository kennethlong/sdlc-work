---
description: Slice a small PRD into ticket-sized, dependency-ordered tickets in the piv spec format that sdlc-atl files into Jira (no epic yet, so nothing is filed).
tags: [spec, smoke]
plugins: ["../../../plugins/sdlc"]
max_turns: 35
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

Here's the approved PRD for "Report exports". This repo uses the piv planning engine and there's no Jira epic yet, so don't file anything; Jira, git and our CLIs aren't reachable from here anyway. Please save the PRD as `docs/prd/report-exports.md`, then break it down into tickets we can work one at a time, saved as `docs/specs/report-exports.md`.

# PRD: Report exports

## Problem
Analysts copy report tables into spreadsheets by hand. It is slow and error-prone.

## Goals
1. Any saved report can be exported as CSV through the API: `GET /api/reports/:id/export.csv`, streaming, works for 200k rows.
2. Exported cells are safe to open in Excel: values starting with `= + - @` are neutralised.
3. An "Export CSV" button on the report page downloads the file, with progress while it runs.
4. Users can schedule a weekly export emailed to them as an attachment; they can list and cancel their schedules on a "Scheduled exports" page.
5. Every export (manual or scheduled) is written to the audit log with user, report and row count.

## Constraints
- Our CSV library `fast-csv` is on 4.x; streaming needs 5.x, so upgrade it first (a chore, no user-visible change).
- Email sending uses the existing `mailer` service.

## Out of scope
Excel/XLSX format; exports of ad-hoc (unsaved) queries.
