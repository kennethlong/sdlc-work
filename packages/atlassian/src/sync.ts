/**
 * Report progress back: move each filed story forward to match its work item's status, and publish verification
 * reports to Confluence, linked from the story. Not in the reference (it ends at the PR), which is a documented
 * deviation: the team lives in Jira/Confluence, so progress should show up there without asking an engineer.
 *
 * Safe to re-run: transitions are no-ops when already there; a story is never moved *backwards* (e.g. out of
 * Done); report pages are only rewritten when the report changed, and a comment is posted only then.
 */
import type { ConfluenceClient } from './confluence.ts';
import type { JiraClient } from './jira.ts';
import type { StateFile } from './state.ts';
import { itemLabel } from './filing.ts';
import type { Breakdown, WorkItem, WorkStatus } from './work.ts';

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

export type SyncReport = {
  items: {
    id: string;
    title: string;
    status: WorkStatus;
    key?: string;
    jiraStatus?: string;
    transition: { to?: string; action: TransitionAction };
    report?: { action: ReportAction; url?: string };
  }[];
  unfiled: string[];
};

export type SyncOptions = {
  jira: JiraClient;
  confluence?: ConfluenceClient;
  breakdown: Breakdown;
  state: StateFile;
  transitions?: TransitionMap;
  /** Space for report pages when there is no breakdown page to nest them under. */
  confluenceSpace?: string;
  dryRun?: boolean;
};

export async function syncProgress(opts: SyncOptions): Promise<SyncReport> {
  const { jira, confluence, breakdown, state, dryRun = false } = opts;
  const transitions = { ...DEFAULT_TRANSITIONS, ...opts.transitions };
  if (!state.data.epic) throw new Error('Nothing filed yet for this repo: run file-breakdown first.');
  const children = await jira.epicIssues(state.data.epic);
  const breakdownPage = state.data.breakdownPageId && confluence ? await confluence.getPage(state.data.breakdownPageId) : undefined;
  const report: SyncReport = { items: [], unfiled: [] };

  for (const item of breakdown.items) {
    const key = issueKeyFor(item);
    if (!key) {
      report.unfiled.push(item.id);
      continue;
    }
    const issue = await jira.getIssue(key, 'status,summary');
    const entry: SyncReport['items'][number] = {
      id: item.id,
      title: item.title,
      status: item.status,
      key,
      jiraStatus: issue?.fields.status?.name,
      transition: await moveForward(key, issue?.fields.status, transitions[item.status]),
    };
    if (item.verification) entry.report = await publishVerification(item, key);
    report.items.push(entry);
  }
  if (!dryRun) state.save();
  return report;

  function issueKeyFor(item: WorkItem): string | undefined {
    const mapped = state.data.items[item.id]?.issueKey;
    if (mapped && children.some((c) => c.key === mapped)) return mapped;
    const byLabel = children.find((c) => c.fields.labels?.includes(itemLabel(item.id)))?.key;
    if (byLabel) state.data.items[item.id] = { ...state.data.items[item.id], issueKey: byLabel };
    return byLabel;
  }

  async function moveForward(key: string, current: { name: string; statusCategory?: { key: string } } | undefined, target?: string) {
    if (!target) return { action: 'none' as const };
    if (current?.name.toLowerCase() === target.toLowerCase()) return { to: target, action: 'already' as const };
    // Never pull work back out of Done (someone closed it deliberately, or a later re-verification regressed).
    if (current?.statusCategory?.key === 'done') return { to: target, action: 'kept-done' as const };
    if (dryRun) return { to: target, action: 'would-move' as const };
    return { to: target, action: (await jira.transitionTo(key, target)) ? ('moved' as const) : ('no-transition' as const) };
  }

  async function publishVerification(item: WorkItem, key: string): Promise<NonNullable<SyncReport['items'][number]['report']>> {
    const v = item.verification!;
    if (!confluence) return { action: 'skipped-no-space' };
    const spaceKey = breakdownPage?.space?.key ?? opts.confluenceSpace;
    if (!spaceKey) return { action: 'skipped-no-space' };
    if (dryRun) return { action: 'would-publish' };

    const passed = v.status === 'passed';
    const title = `Verification: ${key} ${item.title}`;
    const md = [
      `**Story:** [${key}](${jira.browseUrl(key)}) · **Result:** ${passed ? '✅ passed' : `⚠️ ${v.status}`}` +
        (v.score ? ` · **Score:** ${v.score}` : '') +
        (v.verifiedAt ? ` · **Verified:** ${v.verifiedAt}` : ''),
      '',
      `_Published by sdlc-atl from \`${v.path}\` (${breakdown.engine}); edits here are overwritten on the next sync._`,
      '',
      v.markdown,
    ].join('\n');

    const { page, action } = await confluence.upsertPage({ spaceKey, title, markdown: md, parentId: breakdownPage?.id });
    const url = confluence.pageUrl(page);
    state.data.items[item.id] = { ...state.data.items[item.id]!, verificationPageId: page.id };
    if (action !== 'unchanged') {
      await jira.addRemoteLink(key, url, title);
      await jira.addComment(key, `Verification ${passed ? '**passed**' : `**${v.status}**`}${v.score ? ` (${v.score})` : ''}: [report](${url})`);
    }
    return { action, url };
  }
}
