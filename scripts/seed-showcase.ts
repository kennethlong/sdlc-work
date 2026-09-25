#!/usr/bin/env node
// Seed the local DC stack (Jira + Confluence + Bitbucket) with a realistic, screenshot-ready showcase, using only the
// toolset's own operations: PRD page -> filed stories + breakdown page -> synced progress + verification pages ->
// a bug RCA -> a sprint on the board -> a Bitbucket PR with a published review (Code Insights annotations).
// Usage (fresh stack recommended: ./dc.ps1 rebuild): node scripts/seed-showcase.ts
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, envLookup, fileBreakdown, importTicket, openPr, PivEngine, publishRca, publishReview, resolveHost, StateFile, syncProgress } from '../packages/atlassian/src/index.ts';

const repo = fileURLToPath(new URL('..', import.meta.url));
const { jira, confluence } = connect({ cwd: repo });
const env = envLookup({ cwd: repo });
const root = mkdtempSync(join(tmpdir(), 'sdlc-showcase-'));
const w = (rel: string, text: string) => {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), text.trimStart());
};
const log = (s: string) => console.log(s);

// ---- 1. PRD in Confluence ----------------------------------------------------------------------
const prd = await confluence.upsertPage({
  spaceKey: 'SDLC',
  title: 'PRD: Reporting Improvements',
  markdown: `
## Summary

Account managers spend hours each week asking engineering for report exports. Let them export, schedule and share
reports themselves, safely.

## Users and needs

- **Account managers**: export a saved report as CSV and send it to a client, without a ticket to engineering.
- **Team leads**: receive a weekly export automatically.

## Scope

- **In:** CSV export API, export button with progress, scheduled email exports, formula-injection-safe cells.
- **Out:** PDF exports, custom report builder.

## User stories

- As an account manager, I want to export a saved report as CSV so that I can share it with a client.
  - Given a saved report, when I choose Export, then a CSV with all rows downloads within 10 seconds.
- As a team lead, I want a weekly export emailed to me so that I don't have to remember to run it.

## Non-functional requirements

- Exports over 50,000 rows stream without timing out.
- Cells starting with \`=\`, \`+\`, \`-\` or \`@\` are neutralised (spreadsheet formula injection).

## Success metrics

- Export requests to engineering drop by 80% within a month of release.
`,
});
log(`PRD page: ${prd.action}`);

// ---- 2. Epic + ticket breakdown (piv engine) -----------------------------------------------------
const [existingEpic] = await jira.search('project = SDLC AND issuetype = Epic AND summary ~ "\\"Reporting Improvements\\""', { limit: 1 });
const epic =
  existingEpic?.key ??
  (await jira.createIssue({ project: 'SDLC', issueType: 'Epic', summary: 'Reporting Improvements', description: 'Self-service report exports for account managers. PRD in Confluence.' })).key;

w(
  'docs/specs/reporting-improvements.md',
  `
# Spec: Reporting Improvements

## Epic summary

Self-service report exports: CSV API, export UI, scheduled emails, safe cells.

## Tickets

### TICKET-1 — CSV export endpoint
- **Scope:** Any saved report can be exported as CSV through the API
- **Acceptance criteria:**
  - \`GET /reports/{id}/export.csv\` returns every row of the report
  - Exports over 50k rows stream without timing out
- **Depends on:** none

### TICKET-2 — Formula-injection-safe CSV cells
- **Scope:** Exported cells can't execute as spreadsheet formulas
- **Acceptance criteria:**
  - Cells starting with \`=\`, \`+\`, \`-\` or \`@\` are prefixed with a single quote
  - A test covers each prefix
- **Depends on:** TICKET-1

### TICKET-3 — Export button with progress
- **Scope:** Users export from the report viewer and see progress
- **Acceptance criteria:**
  - Report viewer shows an Export button for users with read access
  - Large exports show progress and a download link when done
- **Depends on:** TICKET-1

### TICKET-4 — Export audit log
- **Scope:** Every export is recorded for compliance
- **Acceptance criteria:**
  - Each export writes who, which report, row count and time to the audit log
- **Depends on:** TICKET-1

### TICKET-5 — Scheduled email exports
- **Scope:** Users schedule a report export to be emailed
- **Acceptance criteria:**
  - User can create a daily or weekly schedule for a saved report
  - The export arrives as a CSV attachment
- **Depends on:** TICKET-2, TICKET-3

### TICKET-6 — Schedule management page
- **Scope:** Users see, pause and delete their schedules
- **Acceptance criteria:**
  - A settings page lists schedules with next run time, and pause and delete actions
- **Depends on:** TICKET-5
`,
);
const state = new StateFile(root);
const engine = new PivEngine();
const filed = await fileBreakdown({ jira, confluence, breakdown: await engine.loadBreakdown(root), epicKey: epic, prdPageId: prd.page.id, state });
const key = Object.fromEntries(filed.items.map((i) => [i.id, i.key!]));
log(`Filed ${filed.items.length} stories under ${epic}; breakdown page ${filed.page?.action}`);

// ---- 3. Progress in the engine's own artifacts, then sync --------------------------------------
const report = (k: string, slug: string, results: string[], extra = '') =>
  w(
    `.claude/execution-reports/${k.toLowerCase()}-${slug}.md`,
    `
# Execution Report: ${slug.replace(/-/g, ' ')}

Ticket: ${k}

### Validation Results

${results.map((r) => `- ${r}`).join('\n')}

### What Went Well

- Followed the existing streaming writer pattern in \`src/reports/csv.ts\`.
${extra}
`,
  );
const plan = (k: string, slug: string) => w(`.claude/plans/${k.toLowerCase()}-${slug}.md`, `# Plan: ${slug.replace(/-/g, ' ')}\n\nTicket: ${k}\n`);

plan(key['TICKET-1']!, 'csv-export-endpoint');
report(key['TICKET-1']!, 'csv-export-endpoint', ['Lint: ✓', 'Type check: ✓', 'Unit tests: ✓ 24 passed', 'Integration tests: ✓ 6 passed (200k-row export streamed in 4.1s)']);
plan(key['TICKET-2']!, 'formula-safe-cells');
plan(key['TICKET-3']!, 'export-button');
report(key['TICKET-3']!, 'export-button', ['Lint: ✓', 'Type check: ✓', 'Unit tests: ✓ 18 passed', 'E2E: ✗ progress bar never reaches 100% for exports over 30s'], '\n### Divergences from Plan\n\n**Progress polling**: Planned: websocket updates / Actual: polling every 2s / Why: no websocket gateway in this service.\n');
plan(key['TICKET-4']!, 'export-audit-log');
report(key['TICKET-4']!, 'export-audit-log', ['Lint: ✓', 'Type check: ✓', 'Unit tests: ✓ 9 passed']);

const keys = () => Object.fromEntries(Object.entries(state.data.items).map(([id, v]) => [id, v.issueKey]));
const synced = await syncProgress({ jira, confluence, breakdown: await engine.loadBreakdown(root, { issueKeys: keys() }), state, root, engineFor: () => engine });
for (const i of synced.items) log(`  ${i.key} ${i.status} -> ${i.transition.to ?? '-'} (${i.transition.action})${i.report ? ` report ${i.report.action}` : ''}`);

// ---- 4. A bug with a published RCA ----------------------------------------------------------------
const [existingBug] = await jira.search('project = SDLC AND issuetype = Bug AND summary ~ "\\"no rows\\""', { limit: 1 });
const bug =
  existingBug?.key ??
  (
    await jira.createIssue({
      project: 'SDLC',
      issueType: 'Bug',
      summary: 'CSV export fails for reports with no rows',
      epicKey: epic,
      description: 'Exporting an empty saved report returns HTTP 500 instead of a CSV with just the header row.\n\n**Steps:** create a report with a filter that matches nothing, choose Export.',
    })
  ).key;
await importTicket({ jira, root, key: bug, engine, state });
w(
  `docs/rca/${bug}.md`,
  `
# Root Cause Analysis: ${bug} — CSV export fails for reports with no rows

## Summary
- **Severity:** high: a main export path returns 500 for a common case (filters that match nothing)
- **Reproduced:** yes, with a failing test \`export.empty.test.ts\`

## Problem
Expected: a CSV with only the header row. Actual: HTTP 500, \`TypeError: Cannot read properties of undefined (reading 'columns')\`.

## Root Cause
### Analysis
\`buildRows()\` derives the header from \`rows[0].columns\` (\`src/reports/csv.ts:42\`). For an empty report \`rows[0]\` is undefined, so the header can't be built and the request fails.
### Contributing factors
- The report schema already knows the columns, but the exporter never reads it.
- No test covered an empty report.

## Impact
Every export of an empty filter result fails; scheduled exports of quiet periods would fail too.

## Proposed Fix
### Fix Strategy
Build the header from the report schema instead of the first row, so empty and non-empty reports share one path.
### Files to change
- \`src/reports/csv.ts\`: header from \`report.schema.columns\`

## Prevention
- **Regression test:** \`export.empty.test.ts\`: an empty report exports the header row only
- **Rule:** "Exporters derive headers from the report schema, never from data rows" (added to AGENTS.md)
- **Sweep:** \`src/reports/xlsx.ts:31\` uses the same pattern; fixed in the same change
`,
);
const rca = await publishRca({ jira, confluence, root, key: bug, spaceKey: 'SDLC', state });
log(`RCA ${bug}: ${rca.page.action}`);

// ---- 5. A sprint on the board ---------------------------------------------------------------------
const boards = await jira.http.get<{ values: { id: number; name: string }[] }>('/rest/agile/1.0/board', { projectKeyOrId: 'SDLC' });
const boardId = boards.values[0]!.id;
const sprints = await jira.http.get<{ values: { id: number; state: string }[] }>(`/rest/agile/1.0/board/${boardId}/sprint`, { state: 'active,future' });
let sprint = sprints.values[0];
if (!sprint) {
  sprint = await jira.http.post<{ id: number; state: string }>('/rest/agile/1.0/sprint', { name: 'Reporting Sprint 1', originBoardId: boardId, goal: 'Self-service CSV exports' });
}
await jira.http.post(`/rest/agile/1.0/sprint/${sprint.id}/issue`, { issues: [...Object.values(key), bug] });
if (sprint.state !== 'active') {
  const now = new Date();
  await jira.http.post(`/rest/agile/1.0/sprint/${sprint.id}`, { state: 'active', startDate: now.toISOString(), endDate: new Date(+now + 14 * 864e5).toISOString() });
}
log(`Sprint ${sprint.id} active on board ${boardId}`);

// ---- 6. A Bitbucket PR with a published review ----------------------------------------------------
const token = env('BITBUCKET_TOKEN');
const bbBase = env('BITBUCKET_BASE_URL');
const code = mkdtempSync(join(tmpdir(), 'sdlc-showcase-code-'));
const git = (...a: string[]) => execFileSync('git', ['-c', `http.extraHeader=Authorization: Bearer ${token}`, ...a], { cwd: code, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const write = (rel: string, text: string) => {
  mkdirSync(join(code, rel, '..'), { recursive: true });
  writeFileSync(join(code, rel), text.trimStart());
};
git('init', '-q', '-b', 'main');
git('config', 'user.email', 'dev@example.com');
git('config', 'user.name', 'Sam Rivera');
git('remote', 'add', 'origin', `${bbBase}/scm/sdlc/sandbox.git`);
write('README.md', '# Reports service\n');
write('src/reports/csv.ts', "export function toCsv(rows: string[][]): string {\n  return rows.map((r) => r.join(',')).join('\\n');\n}\n");
git('add', '.');
git('commit', '-qm', 'Reports service baseline');
git('push', '-q', '-f', '-u', 'origin', 'main');
const branch = `feature/${key['TICKET-2']}-formula-safe-cells`;
git('checkout', '-qb', branch);
write(
  'src/reports/csv.ts',
  `
const RISKY = /^[=+\\-]/;

/** Neutralise spreadsheet formulas in exported cells (OWASP CSV injection). */
export function escapeCell(value: string): string {
  return RISKY.test(value) ? \`'\${value}\` : value;
}

export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map(escapeCell).join(',')).join('\\n');
}
`,
);
write(
  'test/csv.test.ts',
  `
import { escapeCell } from '../src/reports/csv';

test.each(['=1+1', '+1', '-1'])('escapes %s', (v) => expect(escapeCell(v)).toBe(\`'\${v}\`));
`,
);
git('add', '.');
git('commit', '-qm', `${key['TICKET-2']} escape formula cells in CSV export`);
git('push', '-q', '-f', '-u', 'origin', branch);
const host = resolveHost(code, { cwd: repo });
const prState = new StateFile(code);
const pr = await openPr({ root: code, host, jira, confluence, state: prState, base: 'main' });
log(`PR ${pr.action}: ${pr.pr?.url}`);
const head = git('rev-parse', '--short', 'HEAD').trim();
write(
  '.sdlc/reviews/review.md',
  `
---
base: main
head: "${head}"
verdict: changes_requested
findings:
  - severity: high
    category: security
    file: src/reports/csv.ts
    line: 1
    title: "@ prefix is not escaped: formula injection still possible"
    detail: "The acceptance criteria list = + - and @, but RISKY only matches = + and -. A cell like @SUM(A1:A9) still executes in Excel and Google Sheets."
    suggestion: "Use /^[=+\\\\-@\\\\t\\\\r]/ and add '@SUM(1)' to the test cases."
  - severity: medium
    category: tests
    file: test/csv.test.ts
    line: 3
    title: "No test for values that must NOT be escaped"
    detail: "Only escaped inputs are tested; a regex that escapes everything would pass."
    suggestion: "Add cases like 'hello' and '1-2' that must come back unchanged."
---
# Code review: ${branch}

The change meets 1 of 2 acceptance criteria: \`@\` is still unescaped. The approach (escape at the cell boundary, shared by every exporter) is right.
`,
);
const published = await publishReview({ root: code, host, jira, file: join(code, '.sdlc/reviews/review.md'), base: 'main' });
log(`Review ${published.verdict}: comment ${published.comment}, annotations ${published.annotations}`);

console.log(JSON.stringify({ epic, stories: key, bug, board: boardId, pr: pr.pr?.url, breakdownPage: filed.page?.url, prdPage: confluence.pageUrl(prd.page), rcaPage: rca.page.url }, null, 2));
