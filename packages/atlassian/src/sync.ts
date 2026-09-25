/**
 * Report progress back: move each filed story (Track A) and imported ticket (Track B) forward to match its work
 * status, and publish verification reports to Confluence, linked from the issue. Not in the reference (it ends at the
 * PR), which is a documented deviation: the team lives in Jira/Confluence, so progress should show up there without
 * asking an engineer.
 *
 * Safe to re-run: transitions are no-ops when already there; an issue is never moved *backwards* (e.g. out of
 * Done); report pages are only rewritten when the report changed, and a comment is posted only then.
 */
import type { ConfluenceClient, ConfluencePage } from './confluence.ts';
import type { JiraClient } from './jira.ts';
import type { StateFile } from './state.ts';
import { itemLabel } from './filing.ts';
import type { Breakdown, Engine, Verification, WorkItem, WorkStatus } from './work.ts';

export type TransitionMap = Partial<Record<WorkStatus, string>>;

/** Default: any started work is In Progress, verified work is Done. Override in .sdlc/config.json jira.transitions. */
export const DEFAULT_TRANSITIONS: TransitionMap = {
  planned: 'In Progress',
  executing: 'In Progress',
  needs_attention: 'In Progress',
  complete: 'Done',
};

type TransitionAction = 'moved' | 'already' | 'would-move' | 'kept-done' | 'no-transition' | 'none';
type ReportAction = 'created' | 'updated' | 'unchanged' | 'would-publish' | 'skipped-no-space';

export type SyncEntry = {
  id: string;
  title: string;
  status: WorkStatus;
  key?: string;
  jiraStatus?: string;
  transition: { to?: string; action: TransitionAction };
  report?: { action: ReportAction; url?: string };
};

export type SyncReport = { items: SyncEntry[]; tickets: SyncEntry[]; unfiled: string[] };

export type SyncOptions = {
  jira: JiraClient;
  confluence?: ConfluenceClient;
  /** Track A: the filed breakdown (omit when nothing has been filed). */
  breakdown?: Breakdown;
  /** Track B: engine to read ticket progress with, per engine name recorded at import. */
  engineFor?: (name: string | undefined) => Engine;
  root?: string;
  state: StateFile;
  transitions?: TransitionMap;
  /** Space for report pages when there is no breakdown page to nest them under (Track B, or unfiled PRD). */
  confluenceSpace?: string;
  dryRun?: boolean;
};

export async function syncProgress(opts: SyncOptions): Promise<SyncReport> {
  const { jira, confluence, breakdown, state, dryRun = false } = opts;
  const transitions = { ...DEFAULT_TRANSITIONS, ...opts.transitions };
  const tickets = Object.entries(state.data.tickets ?? {}).filter(([, t]) => !t.escalatedTo);
  if (!state.data.epic && !tickets.length) throw new Error('Nothing to sync: file a breakdown (file-breakdown) or import a ticket (import) first.');
  const report: SyncReport = { items: [], tickets: [], unfiled: [] };

  // Track A
  if (breakdown && state.data.epic) {
    const children = await jira.epicIssues(state.data.epic);
    const breakdownPage = state.data.breakdownPageId && confluence ? await confluence.getPage(state.data.breakdownPageId) : undefined;
    for (const item of breakdown.items) {
      const key = issueKeyFor(item, children);
      if (!key) {
        report.unfiled.push(item.id);
        continue;
      }
      const entry = await syncOne(key, item.id, item.title, item.status, item.verification, breakdownPage);
      if (entry.pageId) state.data.items[item.id] = { ...state.data.items[item.id]!, verificationPageId: entry.pageId };
      report.items.push(strip(entry));
    }
  }

  // Track B
  if (tickets.length) {
    if (!opts.engineFor || !opts.root) throw new Error('Ticket sync needs engineFor and root.');
    for (const [key, t] of tickets) {
      const progress = await opts.engineFor(t.engine).ticketProgress(opts.root, key);
      const entry = await syncOne(key, key, t.summary ?? key, progress.status, progress.verification, undefined);
      if (entry.pageId) state.data.tickets![key] = { ...t, verificationPageId: entry.pageId };
      report.tickets.push(strip(entry));
    }
  }

  if (!dryRun) state.save();
  return report;

  function issueKeyFor(item: WorkItem, children: { key: string; fields: { labels?: string[] } }[]): string | undefined {
    const mapped = state.data.items[item.id]?.issueKey;
    if (mapped && children.some((c) => c.key === mapped)) return mapped;
    const byLabel = children.find((c) => c.fields.labels?.includes(itemLabel(item.id)))?.key;
    if (byLabel) state.data.items[item.id] = { ...state.data.items[item.id], issueKey: byLabel };
    return byLabel;
  }

  async function syncOne(key: string, id: string, title: string, status: WorkStatus, v: Verification | undefined, parent: ConfluencePage | undefined) {
    const issue = await jira.getIssue(key, 'status,summary');
    const entry: SyncEntry & { pageId?: string } = {
      id,
      title,
      status,
      key,
      jiraStatus: issue?.fields.status?.name,
      transition: await moveForward(key, issue?.fields.status, transitions[status]),
    };
    if (v) {
      const r = await publishVerification(key, title, v, parent);
      entry.report = { action: r.action, url: r.url };
      if (r.pageId) entry.pageId = r.pageId;
    }
    return entry;
  }

  async function moveForward(key: string, current: { name: string; statusCategory?: { key: string } } | undefined, target?: string) {
    if (!target) return { action: 'none' as const };
    if (current?.name.toLowerCase() === target.toLowerCase()) return { to: target, action: 'already' as const };
    // Never pull work back out of Done (someone closed it deliberately, or a later re-verification regressed).
    if (current?.statusCategory?.key === 'done') return { to: target, action: 'kept-done' as const };
    if (dryRun) return { to: target, action: 'would-move' as const };
    return { to: target, action: (await jira.transitionTo(key, target)) ? ('moved' as const) : ('no-transition' as const) };
  }

  async function publishVerification(key: string, title: string, v: Verification, parent: ConfluencePage | undefined): Promise<{ action: ReportAction; url?: string; pageId?: string }> {
    if (!confluence) return { action: 'skipped-no-space' };
    const spaceKey = parent?.space?.key ?? opts.confluenceSpace;
    if (!spaceKey) return { action: 'skipped-no-space' };
    if (dryRun) return { action: 'would-publish' };

    const passed = v.status === 'passed';
    const pageTitle = `Verification: ${key} ${title}`;
    const md = [
      `**Issue:** [${key}](${jira.browseUrl(key)}) · **Result:** ${passed ? '✅ passed' : `⚠️ ${v.status}`}` +
        (v.score ? ` · **Score:** ${v.score}` : '') +
        (v.verifiedAt ? ` · **Verified:** ${v.verifiedAt}` : ''),
      '',
      `_Published by sdlc-atl from \`${v.path}\`; edits here are overwritten on the next sync._`,
      '',
      v.markdown,
    ].join('\n');

    const { page, action } = await confluence.upsertPage({ spaceKey, title: pageTitle, markdown: md, parentId: parent?.id });
    const url = confluence.pageUrl(page);
    if (action !== 'unchanged') {
      await jira.addRemoteLink(key, url, pageTitle);
      await jira.addComment(key, `Verification ${passed ? '**passed**' : `**${v.status}**`}${v.score ? ` (${v.score})` : ''}: [report](${url})`);
    }
    return { action, url, pageId: page.id };
  }
}

function strip(e: SyncEntry & { pageId?: string }): SyncEntry {
  const { pageId: _pageId, ...rest } = e;
  return rest;
}
