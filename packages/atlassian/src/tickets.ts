/**
 * Track B: small features and bugs worked straight from a Jira ticket (no PRD, no breakdown).
 *
 * Reference: `/prime <jira-key>` loads the ticket into the session, then the PIV loop runs; bugs go `/rca` (a
 * `docs/rca/issue-<n>.md` doc in a fixed template) -> `/implement-fix` -> every bug becomes a rule + regression test.
 * Deviations: the primed ticket is persisted as a brief (`.sdlc/tickets/<KEY>.md`) so a fresh session, another
 * agent, or GSD's planner can read it; RCA docs are keyed by Jira key (`docs/rca/<KEY>.md`), not GitHub issue number,
 * and are published to Confluence + the Jira bug.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ConfluenceClient } from './confluence.ts';
import { JiraClient } from './jira.ts';
import type { StateFile } from './state.ts';
import type { Engine } from './work.ts';

export type ImportResult = { key: string; type: string; summary: string; brief: string; isBug: boolean; epic?: string };

const BUG_TYPES = /^(bug|defect|incident|problem)$/i;

export async function importTicket(opts: { jira: JiraClient; root: string; key: string; engine: Engine; state: StateFile }): Promise<ImportResult> {
  const { jira, root, key, engine, state } = opts;
  const issue = await jira.getIssue(key, 'summary,issuetype,status,description,labels,priority,comment');
  if (!issue) throw new Error(`Issue ${key} not found`);
  const f = issue.fields;
  const type = f.issuetype?.name ?? 'Issue';
  const isBug = BUG_TYPES.test(type);
  const epic = await jira.epicOf(issue.key);
  const description = JiraClient.descriptionMarkdown(issue);
  const criteria = acceptanceCriteria(description);
  const comments = ((f.comment?.comments ?? []) as { author: { displayName?: string; name: string }; created: string; body: string }[]).slice(-5);

  const md = [
    '---',
    `key: ${issue.key}`,
    `type: ${type}`,
    `status: ${f.status?.name ?? ''}`,
    ...(epic ? [`epic: ${epic}`] : []),
    `url: ${jira.browseUrl(issue.key)}`,
    `engine: ${engine.name}`,
    `imported: ${new Date().toISOString()}`,
    '---',
    '',
    `# ${issue.key}: ${f.summary}`,
    '',
    `**Type:** ${type} · **Status:** ${f.status?.name ?? '?'}${f.priority?.name ? ` · **Priority:** ${f.priority.name}` : ''}` +
      (f.labels?.length ? ` · **Labels:** ${f.labels.join(', ')}` : ''),
    '',
    '## Description',
    '',
    description || '_(empty)_',
    '',
    '## Acceptance criteria',
    '',
    ...(criteria.length ? criteria.map((c) => `- [ ] ${c}`) : ['_None stated in the ticket. Clarify with the reporter before planning, or derive and confirm them._']),
    '',
    ...(comments.length
      ? ['## Recent comments', '', ...comments.flatMap((c) => [`**${c.author.displayName ?? c.author.name}** (${c.created.slice(0, 10)}):`, '', JiraClient.wikiToMarkdown(c.body), ''])]
      : []),
    '## Next steps',
    '',
    ...engine.nextSteps(issue.key, f.summary, isBug).map((s, i) => `${i + 1}. ${s}`),
    '',
    `_Imported by sdlc-atl. If this turns out bigger than one ticket, escalate: \`sdlc-atl escalate ${issue.key} --epic <EPIC>\` and write a PRD (Track A)._`,
    '',
  ].join('\n');

  const brief = join(root, '.sdlc', 'tickets', `${issue.key}.md`);
  mkdirSync(dirname(brief), { recursive: true });
  writeFileSync(brief, md);
  state.data.tickets ??= {};
  state.data.tickets[issue.key] = { ...state.data.tickets[issue.key], type, summary: f.summary, engine: engine.name };
  state.save();
  return { key: issue.key, type, summary: f.summary, brief, isBug, epic };
}

/** Acceptance criteria from a markdown description: list items under an "Acceptance criteria" heading or label. */
export function acceptanceCriteria(md: string): string[] {
  const m = md.match(/^(?:#+\s*|\*\*)?acceptance criteria\b[^\n]*\n+((?:\s*(?:[-*]|\d+\.)\s+.+\n?)+)/im);
  if (!m) return [];
  return m[1]!
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*]|\d+\.)\s+(?:\[[ xX]\]\s+)?/, '').trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------------------------

export type RcaReport = { page: { id: string; url: string; action: string }; commented: boolean; warnings: string[] };

const RCA_PARENT = 'Root Cause Analyses';

/**
 * Publish `docs/rca/<KEY>.md` (the reference's RCA template) as "RCA: <KEY> <summary>" under a "Root Cause
 * Analyses" page in the space, link it from the bug, and comment the root cause + fix strategy. Re-publishing an
 * unchanged doc is a no-op. Warns when the doc lacks what the reference's learning loop needs.
 */
export async function publishRca(opts: {
  jira: JiraClient;
  confluence: ConfluenceClient;
  root: string;
  key: string;
  spaceKey: string;
  file?: string;
  state: StateFile;
}): Promise<RcaReport> {
  const { jira, confluence, root, key, spaceKey, state } = opts;
  const file = opts.file ?? join(root, 'docs', 'rca', `${key}.md`);
  if (!existsSync(file)) throw new Error(`No RCA doc at ${file} (run /rca ${key} first).`);
  const md = readFileSync(file, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const issue = await jira.getIssue(key, 'summary');
  if (!issue) throw new Error(`Issue ${key} not found`);

  const warnings: string[] = [];
  const rootCause = section(md, /root cause/i);
  if (!rootCause) warnings.push('No "Root Cause" section.');
  if (!/regression/i.test(md)) warnings.push('No regression test named: every bug should get one (reference: "the class can\'t recur").');
  if (!section(md, /prevention|rule/i)) warnings.push('No "Prevention" section proposing a rule for AGENTS.md / context, so this class of bug can recur.');

  const parent = (await confluence.findPage(spaceKey, RCA_PARENT)) ?? (await confluence.createPage({ spaceKey, title: RCA_PARENT, markdown: 'Root cause analyses published by sdlc-atl, one per bug.' }));
  const title = `RCA: ${key} ${issue.fields.summary}`;
  const body = [`**Bug:** [${key}](${jira.browseUrl(key)})`, '', `_Published by sdlc-atl from \`docs/rca/${key}.md\`; edits here are overwritten on the next publish._`, '', md].join('\n');
  const { page, action } = await confluence.upsertPage({ spaceKey, title, markdown: body, parentId: parent.id });
  const url = confluence.pageUrl(page);

  let commented = false;
  if (action !== 'unchanged') {
    await jira.addRemoteLink(key, url, title);
    const analysis = section(rootCause ?? '', /analysis/i) ?? rootCause ?? '';
    const fix = section(section(md, /proposed fix|fix/i) ?? '', /strategy/i) ?? '';
    await jira.addComment(
      key,
      [`**Root cause analysis** ${action === 'created' ? 'published' : 'updated'}: [${title}](${url})`, '', clip(analysis, 900), ...(fix ? ['', `**Fix strategy:** ${clip(fix, 500)}`] : [])].join('\n'),
    );
    commented = true;
  }
  state.data.tickets ??= {};
  state.data.tickets[key] = { ...state.data.tickets[key], rcaPageId: page.id };
  state.save();
  return { page: { id: page.id, url, action }, commented, warnings };
}

/** Body of the first heading matching `title` (any level), up to the next heading of the same or higher level. */
function section(md: string, title: RegExp): string | undefined {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => /^#{1,6}\s/.test(l) && title.test(l.replace(/^#+\s*/, '')));
  if (start < 0) return undefined;
  const level = lines[start]!.match(/^#+/)![0].length;
  const end = lines.findIndex((l, i) => i > start && /^#{1,6}\s/.test(l) && l.match(/^#+/)![0].length <= level);
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim() || undefined;
}

function clip(s: string, n: number): string {
  const t = s.trim();
  return t.length > n ? t.slice(0, n).replace(/\s+\S*$/, '') + ' …' : t;
}

// ---------------------------------------------------------------------------------------------

/** Track B -> Track A: the ticket turned out bigger than one ticket. Link it to the epic and say so. */
export async function escalateTicket(opts: { jira: JiraClient; key: string; epic: string; state: StateFile }) {
  const { jira, key, epic, state } = opts;
  const target = await jira.getIssue(epic, 'issuetype,summary');
  if (target?.fields.issuetype?.name.toLowerCase() !== 'epic') throw new Error(`${epic} is not an Epic`);
  await jira.setEpic(key, epic);
  await jira.addComment(key, `Escalated to Track A: bigger than one ticket. Now part of ${epic} (${target.fields.summary}); needs a PRD and a ticket breakdown.`);
  state.data.tickets ??= {};
  state.data.tickets[key] = { ...state.data.tickets[key], escalatedTo: epic };
  state.save();
}

