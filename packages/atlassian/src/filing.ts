/**
 * File a work breakdown as Jira stories under an epic, and publish the breakdown under the PRD in Confluence.
 * This is the reference `/spec` skill's steps 5–6, made deterministic and re-runnable.
 *
 * Idempotency, in order: `.sdlc/atlassian.json` mapping, then the `sdlc-item-<id>` label on an epic child,
 * then an epic child with the same summary (the reference's duplicate check). Matches are adopted, never duplicated.
 */
import type { ConfluenceClient } from './confluence.ts';
import type { JiraClient, JiraIssue } from './jira.ts';
import type { StateFile } from './state.ts';
import { breakdownWarnings, waves, type Breakdown, type WorkItem } from './work.ts';

export type ItemAction = 'created' | 'adopted' | 'existing' | 'would-create' | 'would-adopt';
export type FilingReport = {
  epic: string;
  items: { id: string; title: string; key?: string; action: ItemAction; wave: number }[];
  links: { from: string; to: string; action: 'created' | 'existing' | 'would-create' }[];
  page?: { title: string; id?: string; url?: string; action: string };
  warnings: string[];
};

export type FilingOptions = {
  jira: JiraClient;
  confluence?: ConfluenceClient;
  breakdown: Breakdown;
  epicKey: string;
  prdPageId?: string;
  state: StateFile;
  issueType?: string;
  dryRun?: boolean;
};

export const itemLabel = (id: string) => `sdlc-item-${id}`;
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

export async function fileBreakdown(opts: FilingOptions): Promise<FilingReport> {
  const { jira, breakdown, epicKey, state, dryRun = false } = opts;
  const epic = await jira.getIssue(epicKey, 'summary,project,issuetype');
  if (!epic) throw new Error(`Epic ${epicKey} not found`);
  if (epic.fields.issuetype?.name.toLowerCase() !== 'epic') throw new Error(`${epicKey} is a ${epic.fields.issuetype?.name}, not an Epic`);
  if (state.data.epic && state.data.epic !== epicKey) {
    throw new Error(`This repo's breakdown is already filed under ${state.data.epic}; refusing to file it under ${epicKey} too.`);
  }
  const project = (epic.fields.project as { key: string }).key;
  const children = await jira.epicIssues(epicKey);
  const report: FilingReport = { epic: epicKey, items: [], links: [], warnings: breakdownWarnings(breakdown.items) };
  const keyOf = new Map<string, string>();

  const ordered = waves(breakdown.items);
  for (const [w, wave] of ordered.entries()) {
    for (const item of wave) {
      const { key, action } = await resolveOrCreate(item, w + 1);
      if (key) keyOf.set(item.id, key);
      report.items.push({ id: item.id, title: item.title, key, action, wave: w + 1 });
    }
  }

  // Dependency links: "<dep> blocks <item>".
  for (const item of breakdown.items) {
    const key = keyOf.get(item.id);
    for (const dep of item.dependsOn) {
      const depKey = keyOf.get(dep);
      if (!depKey) continue;
      if (!key) {
        report.links.push({ from: dep, to: item.id, action: 'would-create' });
        continue;
      }
      const links = ((await jira.getIssue(key, 'issuelinks'))!.fields.issuelinks ?? []) as { type: { name: string }; inwardIssue?: { key: string } }[];
      if (links.some((l) => l.type.name === 'Blocks' && l.inwardIssue?.key === depKey)) {
        report.links.push({ from: depKey, to: key, action: 'existing' });
      } else if (dryRun) {
        report.links.push({ from: depKey, to: key, action: 'would-create' });
      } else {
        await jira.linkIssues('Blocks', depKey, key);
        report.links.push({ from: depKey, to: key, action: 'created' });
      }
    }
  }

  if (opts.prdPageId) report.page = await publishBreakdown(opts, epic, report);

  if (!dryRun) {
    state.data.epic = epicKey;
    state.save();
  }
  return report;

  async function resolveOrCreate(item: WorkItem, wave: number): Promise<{ key?: string; action: ItemAction }> {
    const label = itemLabel(item.id);
    const mapped = state.data.items[item.id]?.issueKey;
    // Trust the mapping only if the issue still carries our label: keys get reused (e.g. a rebuilt instance).
    if (mapped && (await jira.getIssue(mapped, 'labels'))?.fields.labels?.includes(label)) return { key: mapped, action: 'existing' };

    const match =
      children.find((c) => c.fields.labels?.includes(label)) ?? children.find((c) => norm(c.fields.summary) === norm(item.title));
    if (match) {
      if (dryRun) return { key: match.key, action: 'would-adopt' };
      if (!match.fields.labels?.includes(label)) await jira.updateIssue(match.key, { labels: [...(match.fields.labels ?? []), label] });
      state.data.items[item.id] = { issueKey: match.key };
      return { key: match.key, action: 'adopted' };
    }

    if (dryRun) return { action: 'would-create' };
    const created = await jira.createIssue({
      project,
      issueType: item.issueType ?? opts.issueType ?? 'Story', // a spec ticket can say "Type: Task" (chores)
      summary: item.title,
      description: storyDescription(item, wave, breakdown),
      labels: ['sdlc', label],
      epicKey,
    });
    state.data.items[item.id] = { issueKey: created.key };
    state.save(); // persist as we go, so a failure part-way leaves a re-runnable state
    return { key: created.key, action: 'created' };
  }
}

export function storyDescription(item: WorkItem, wave: number, breakdown: Breakdown): string {
  const byId = new Map(breakdown.items.map((i) => [i.id, i]));
  const lines = [`**Goal:** ${item.goal}`, '', '## Acceptance criteria', ''];
  lines.push(...(item.acceptanceCriteria.length ? item.acceptanceCriteria.map((c) => `- [ ] ${c}`) : ['- [ ] _(to be defined)_']));
  lines.push('');
  if (item.requirements.length) lines.push(`**Requirements:** ${item.requirements.join(', ')}`, '');
  const deps = item.dependsOn.map((d) => byId.get(d)?.title ?? d);
  lines.push(`**Depends on:** ${deps.length ? deps.join('; ') : 'none'}`, '', `**Wave:** ${wave}`, '');
  lines.push(`_Source: ${breakdown.engine.toUpperCase()} ${item.source}. Filed by sdlc-atl; planning and progress are tracked there._`);
  return lines.join('\n');
}

async function publishBreakdown(opts: FilingOptions, epic: JiraIssue, report: FilingReport): Promise<NonNullable<FilingReport['page']>> {
  const { confluence, jira, breakdown, prdPageId, state, dryRun } = opts;
  const title = `Spec: ${epic.fields.summary} - Ticket Breakdown`; // the reference's page title
  if (!confluence) throw new Error('Publishing the breakdown needs Confluence configured (CONFLUENCE_BASE_URL / CONFLUENCE_PAT).');
  const prd = await confluence.getPage(prdPageId!);
  if (!prd) throw new Error(`PRD page ${prdPageId} not found`);

  const link = (key?: string) => (key ? `[${key}](${jira.browseUrl(key)})` : '_(not filed)_');
  const byId = new Map(report.items.map((i) => [i.id, i]));
  const md = [
    `Epic: ${link(epic.key)} · PRD: [${prd.title}](${confluence.pageUrl(prd)}) · Engine: ${breakdown.engine}`,
    '',
    breakdown.overview,
    '',
    '## Tickets',
    '',
    '| Ticket | Title | Depends on | Wave |',
    '|---|---|---|---|',
    ...breakdown.items.map((i) => {
      const r = byId.get(i.id)!;
      const deps = i.dependsOn.map((d) => byId.get(d)?.key ?? d).join(', ') || 'none';
      return `| ${link(r.key)} | ${i.title} | ${deps} | ${r.wave} |`;
    }),
    '',
    '## Suggested execution order',
    '',
    ...waves(breakdown.items).map((w, n) => `- **Wave ${n + 1}${w.length > 1 ? ' (parallel)' : ''}:** ${w.map((i) => byId.get(i.id)?.key ?? i.title).join(', ')}`),
    '',
    '_Generated by sdlc-atl from the planning artifacts in the repo; edits here are overwritten on the next filing._',
  ].join('\n');

  if (dryRun) {
    const preview = await confluence.upsertPreview({ spaceKey: prd.space!.key, title, markdown: md });
    return { title, action: preview === 'unchanged' ? 'unchanged' : `would-${preview}` };
  }
  const { page, action } = await confluence.upsertPage({ spaceKey: prd.space!.key, title, markdown: md, parentId: prd.id });
  state.data.breakdownPageId = page.id;
  const url = confluence.pageUrl(page);
  await jira.addRemoteLink(epic.key, url, title);
  return { title, id: page.id, url, action };
}
