// Slice 3 end to end: GSD progress -> Jira transitions + Confluence verification reports, on the local DC stack.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, ConfluenceClient, fileBreakdown, GsdEngine, JiraClient, loadConfig, StateFile, syncProgress } from '../src/index.ts';
import { findGsdTools } from '../src/engines/index.ts';

const cfg = loadConfig();
const fixture = fileURLToPath(new URL('./fixtures/gsd-project', import.meta.url));
const hasGsd = (() => {
  try {
    return !!findGsdTools(fixture);
  } catch {
    return false;
  }
})();
const run = `t${Date.now().toString(36)}`;

describe.skipIf(!cfg.jira || !cfg.confluence || !hasGsd)('sync (live)', () => {
  let jira: JiraClient;
  let confluence: ConfluenceClient;
  let root: string;
  let epic = '';
  let prdId = '';
  const key: Record<string, string> = {};

  const phase2 = () => join(root, '.planning', 'phases', '02-export-ui');
  const writeVerification2 = (status: string, score: string) =>
    writeFileSync(
      join(phase2(), '02-VERIFICATION.md'),
      `---\nphase: 02-export-ui\nverified: 2026-09-24T12:00:00Z\nstatus: ${status}\nscore: ${score}\n---\n\n# Phase 2: Export UI Verification Report\n\n**Status:** ${status}\n`,
    );
  const sync = async (dryRun = false) =>
    syncProgress({ jira, confluence, breakdown: await new GsdEngine().loadBreakdown(root), state: new StateFile(root), dryRun });
  const byId = (r: Awaited<ReturnType<typeof sync>>, id: string) => r.items.find((i) => i.id === id)!;
  const status = async (id: string) => (await jira.getIssue(key[id]!, 'status'))!.fields.status!.name;

  beforeAll(async () => {
    ({ jira, confluence } = connect());
    root = mkdtempSync(join(tmpdir(), 'sdlc-sync-'));
    cpSync(fixture, root, { recursive: true });
    epic = (await jira.createIssue({ project: 'SDLC', issueType: 'Epic', summary: `${run} Reporting` })).key;
    prdId = (await confluence.createPage({ spaceKey: 'SDLC', title: `${run} PRD`, markdown: '# PRD' })).id;
    const filed = await fileBreakdown({ jira, confluence, breakdown: await new GsdEngine().loadBreakdown(root), epicKey: epic, prdPageId: prdId, state: new StateFile(root) });
    for (const i of filed.items) key[i.id] = i.key!;
  });

  afterAll(async () => {
    for (const i of await jira.epicIssues(epic)) await jira.deleteIssue(i.key);
    await jira.deleteIssue(epic);
    const breakdownId = new StateFile(root).data.breakdownPageId;
    if (breakdownId) for (const child of await confluence.children(breakdownId)) await confluence.deletePage(child.id);
    for (const child of await confluence.children(prdId)) await confluence.deletePage(child.id);
    await confluence.deletePage(prdId);
    rmSync(root, { recursive: true, force: true });
  });

  it('dry run reports the plan and changes nothing', async () => {
    const r = await sync(true);
    expect(byId(r, '1')).toMatchObject({ status: 'complete', transition: { to: 'Done', action: 'would-move' }, report: { action: 'would-publish' } });
    expect(byId(r, '2')).toMatchObject({ status: 'planned', transition: { to: 'In Progress', action: 'would-move' } });
    expect(byId(r, '3')).toMatchObject({ status: 'not_started', transition: { action: 'none' } });
    expect(await status('1')).toBe('To Do');
  });

  it('moves stories forward and publishes the verification report under the breakdown page', async () => {
    const r = await sync();
    expect(byId(r, '1').transition.action).toBe('moved');
    expect(byId(r, '2').transition.action).toBe('moved');
    expect([await status('1'), await status('2'), await status('3')]).toEqual(['Done', 'In Progress', 'To Do']);

    const rep = byId(r, '1').report!;
    expect(rep.action).toBe('created');
    const page = (await confluence.findPage('SDLC', `Verification: ${key['1']} CSV export endpoint`))!;
    expect(page.ancestors?.at(-1)?.id).toBe(new StateFile(root).data.breakdownPageId);
    const md = ConfluenceClient.markdown((await confluence.getPage(page.id))!);
    expect(md).toContain('✅ passed');
    expect(md).toContain('3/3 must-haves verified');
    expect(md).toContain('```bash\nnpm test -- export\n```');

    const comments = await jira.comments(key['1']!);
    expect(comments).toHaveLength(1);
    expect(comments[0]!.body).toContain('Verification *passed* (3/3 must-haves verified)');
    const links = await jira.http.get<{ object: { url: string } }[]>(`/rest/api/2/issue/${key['1']}/remotelink`);
    expect(links.map((l) => l.object.url)).toContain(rep.url);
  });

  it('re-running is a no-op: no moves, no page versions, no duplicate comments', async () => {
    const r = await sync();
    expect(r.items.map((i) => i.transition.action)).toEqual(['already', 'already', 'none']);
    expect(byId(r, '1').report!.action).toBe('unchanged');
    expect(await jira.comments(key['1']!)).toHaveLength(1);
  });

  it('a failed verification keeps the story in progress and publishes the gaps', async () => {
    writeFileSync(join(phase2(), '02-01-SUMMARY.md'), '---\nphase: 02-export-ui\nplan: 01\n---\n\n# Summary\n');
    writeVerification2('gaps_found', '1/2 must-haves verified');
    const r = await sync();
    expect(byId(r, '2')).toMatchObject({ status: 'needs_attention', transition: { action: 'already' }, report: { action: 'created' } });
    expect(await status('2')).toBe('In Progress');
    expect((await jira.comments(key['2']!)).at(-1)!.body).toContain('Verification *gaps_found* (1/2 must-haves verified)');
  });

  it('passing on re-verification moves it to Done and updates the same report page', async () => {
    writeVerification2('passed', '2/2 must-haves verified');
    const r = await sync();
    expect(byId(r, '2')).toMatchObject({ status: 'complete', transition: { action: 'moved' }, report: { action: 'updated' } });
    expect(await status('2')).toBe('Done');
  });

  it('never pulls a story back out of Done', async () => {
    writeVerification2('gaps_found', '1/2 must-haves verified');
    const r = await sync();
    expect(byId(r, '2').transition.action).toBe('kept-done');
    expect(await status('2')).toBe('Done');
  });
});
