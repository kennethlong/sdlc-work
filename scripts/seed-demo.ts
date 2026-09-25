#!/usr/bin/env node
// Seed the local DC stack with a browsable Track A demo: an epic, a PRD page, and the GSD fixture roadmap filed
// as stories + a ticket-breakdown page under the PRD. Idempotent. Usage: node scripts/seed-demo.ts
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, fileBreakdown, GsdEngine, StateFile } from '../packages/atlassian/src/index.ts';

const repo = fileURLToPath(new URL('..', import.meta.url));
const work = join(repo, '.sdlc-demo'); // gitignored; holds the demo's mapping state
if (!existsSync(work)) {
  mkdirSync(work, { recursive: true });
  cpSync(join(repo, 'packages/atlassian/test/fixtures/gsd-project'), work, { recursive: true });
}

const { jira, confluence } = connect({ cwd: repo });
const title = 'Reporting Improvements';

const [existingEpic] = await jira.search(`project = SDLC AND issuetype = Epic AND summary ~ "\\"${title}\\"" ORDER BY created ASC`, { limit: 1 });
const epic =
  existingEpic?.key ??
  (await jira.createIssue({ project: 'SDLC', issueType: 'Epic', summary: title, description: 'Let account managers export and schedule reports. PRD in Confluence.' })).key;

const prdTitle = `PRD: ${title}`;
const prd =
  (await confluence.findPage('SDLC', prdTitle)) ??
  (await confluence.createPage({
    spaceKey: 'SDLC',
    title: prdTitle,
    markdown: [
      `# ${prdTitle}`,
      '',
      '## Goal',
      '',
      'Account managers can export and schedule reports without engineering help.',
      '',
      '## User stories',
      '',
      '- As an account manager, I want to export a saved report as CSV so that I can share it.',
      '- As an account manager, I want scheduled exports emailed to me.',
      '',
      '## Out of scope',
      '',
      '- PDF exports',
    ].join('\n'),
  }));

const state = new StateFile(work);
// A new epic means a new (rebuilt) instance: the old mapping is meaningless there.
if (!existingEpic || (state.data.epic && state.data.epic !== epic)) state.data = { items: {} };
const report = await fileBreakdown({ jira, confluence, breakdown: await new GsdEngine().loadBreakdown(work), epicKey: epic, prdPageId: prd.id, state });

console.log(`Epic ${epic}: ${jira.browseUrl(epic)}`);
for (const i of report.items) console.log(`  ${i.key}  ${i.action.padEnd(9)} wave ${i.wave}  ${i.title}`);
console.log(`PRD:       ${confluence.pageUrl(prd)}`);
console.log(`Breakdown: ${report.page?.url} (${report.page?.action})`);
