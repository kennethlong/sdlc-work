// Slice 3 end to end, for every engine: progress -> Jira transitions + Confluence verification reports.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect, ConfluenceClient, fileBreakdown, JiraClient, loadConfig, StateFile, syncProgress } from '../src/index.ts';
import { ENGINE_CASES } from './engines.ts';

const cfg = loadConfig();

describe.each(ENGINE_CASES)('sync (live, $name engine)', (ec) => {
  const run = `t${Date.now().toString(36)}${ec.name}`;
  const [id1, id2, id3] = ec.ids;
  if (!cfg.jira || !cfg.confluence || !ec.available) {
    it.skip('needs the local DC stack and the engine installed', () => {});
    return;
  }

  let jira: JiraClient;
  let confluence: ConfluenceClient;
  let root: string;
  let epic = '';
  let prdId = '';
  const key: Record<string, string> = {};

  const keysOf = () => Object.fromEntries(Object.entries(new StateFile(root).data.items).map(([id, v]) => [id, v.issueKey]));
  const sync = async (dryRun = false) =>
    syncProgress({ jira, confluence, breakdown: await ec.engine().loadBreakdown(root, { issueKeys: keysOf() }), state: new StateFile(root), dryRun });
  const byId = (r: Awaited<ReturnType<typeof sync>>, id: string) => r.items.find((i) => i.id === id)!;
  const status = async (id: string) => (await jira.getIssue(key[id]!, 'status'))!.fields.status!.name;

  beforeAll(async () => {
    ({ jira, confluence } = connect());
    root = mkdtempSync(join(tmpdir(), 'sdlc-sync-'));
    cpSync(ec.fixture, root, { recursive: true });
    epic = (await jira.createIssue({ project: 'SDLC', issueType: 'Epic', summary: `${run} Reporting` })).key;
    prdId = (await confluence.createPage({ spaceKey: 'SDLC', title: `${run} PRD`, markdown: '# PRD' })).id;
    const filed = await fileBreakdown({ jira, confluence, breakdown: await ec.engine().loadBreakdown(root), epicKey: epic, prdPageId: prdId, state: new StateFile(root) });
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
    expect(byId(r, id1)).toMatchObject({ status: 'complete', transition: { to: 'Done', action: 'would-move' }, report: { action: 'would-publish' } });
    expect(byId(r, id2)).toMatchObject({ status: 'planned', transition: { to: 'In Progress', action: 'would-move' } });
    expect(byId(r, id3)).toMatchObject({ status: 'not_started', transition: { action: 'none' } });
    expect(await status(id1)).toBe('To Do');
  });

  it('moves stories forward and publishes the verification report under the breakdown page', async () => {
    const r = await sync();
    expect(byId(r, id1).transition.action).toBe('moved');
    expect(byId(r, id2).transition.action).toBe('moved');
    expect([await status(id1), await status(id2), await status(id3)]).toEqual(['Done', 'In Progress', 'To Do']);

    const rep = byId(r, id1).report!;
    expect(rep.action).toBe('created');
    const page = (await confluence.findPage('SDLC', `Verification: ${key[id1]} CSV export endpoint`))!;
    expect(page.ancestors?.at(-1)?.id).toBe(new StateFile(root).data.breakdownPageId);
    expect(ConfluenceClient.markdown((await confluence.getPage(page.id))!)).toContain('✅ passed');

    const comments = await jira.comments(key[id1]!);
    expect(comments).toHaveLength(1);
    expect(comments[0]!.body).toMatch(/^Verification \*passed\* \(\d+\/\d+ /);
    const links = await jira.http.get<{ object: { url: string } }[]>(`/rest/api/2/issue/${key[id1]}/remotelink`);
    expect(links.map((l) => l.object.url)).toContain(rep.url);
  });

  it('re-running is a no-op: no moves, no page versions, no duplicate comments', async () => {
    const r = await sync();
    expect(r.items.map((i) => i.transition.action)).toEqual(['already', 'already', 'none']);
    expect(byId(r, id1).report!.action).toBe('unchanged');
    expect(await jira.comments(key[id1]!)).toHaveLength(1);
  });

  it('a failed verification keeps the story in progress and publishes the result', async () => {
    ec.failItem2(root);
    const r = await sync();
    expect(byId(r, id2)).toMatchObject({ status: 'needs_attention', transition: { action: 'already' }, report: { action: 'created' } });
    expect(await status(id2)).toBe('In Progress');
    expect((await jira.comments(key[id2]!)).at(-1)!.body).toContain(`Verification *${ec.failedStatus}*`);
  });

  it('passing on re-verification moves it to Done and updates the same report page', async () => {
    ec.passItem2(root);
    const r = await sync();
    expect(byId(r, id2)).toMatchObject({ status: 'complete', transition: { action: 'moved' }, report: { action: 'updated' } });
    expect(await status(id2)).toBe('Done');
  });

  it('never pulls a story back out of Done', async () => {
    ec.failItem2(root);
    const r = await sync();
    expect(byId(r, id2).transition.action).toBe('kept-done');
    expect(await status(id2)).toBe('Done');
  });
});
