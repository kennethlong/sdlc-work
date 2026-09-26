---
description: A bug with a clear root cause. The RCA must find the cause (not the symptom) and leave a regression test and a prevention rule, in the RCA doc the fix and publish steps read.
tags: [rca, smoke]
plugins: ["../../../plugins/sdlc"]
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

We have a Jira bug I need root-caused before anyone fixes it. Jira, git and our CLIs aren't reachable from here, so here is everything. Don't fix the code yet.

**SHOP-77 (Bug): "CSV export returns 500 for reports with no rows"**
Reporter: "Exporting the 'Refunds this week' report gives an error page. Other reports export fine. It started after last month's export rewrite."
Log:

```
TypeError: Cannot read properties of undefined (reading 'columns')
    at buildRows (src/reports/csv.ts:14:28)
    at exportCsv (src/reports/csv.ts:5:17)
    at /api/reports/:id/export.csv (src/api/reports.ts:31:12)
```

`src/reports/csv.ts`:

```ts
 1  import type { Report, Row } from './types';
 2
 3  /** GET /api/reports/:id/export.csv */
 4  export function exportCsv(report: Report): string {
 5    const lines = buildRows(report.rows);
 6    return lines.map((cells) => cells.map(escapeCell).join(',')).join('\n');
 7  }
 8
 9  function escapeCell(v: string): string {
10    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
11  }
12
13  function buildRows(rows: Row[]): string[][] {
14    const header = rows[0].columns.map((c) => c.name);
15    return [header, ...rows.map((r) => r.columns.map((c) => String(c.value ?? '')))];
16  }
```

`src/reports/types.ts`: `type Report = { id: string; name: string; schema: { columns: { name: string }[] }; rows: Row[] }` and `type Row = { columns: { name: string; value: unknown }[] }`.
Tests: `src/reports/csv.test.ts` has three tests, all with non-empty reports. The 'Refunds this week' report has no rows this week.

Please do the root-cause analysis and write it up the way our team records RCAs.
