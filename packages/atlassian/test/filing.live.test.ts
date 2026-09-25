// End-to-end Track A filing against the local DC stack, for every engine: fixture -> stories under an epic + breakdown page.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect, ConfluenceClient, fileBreakdown, JiraClient, loadConfig, StateFile, type Breakdown } from '../src/index.ts';
import { ENGINE_CASES, TEST_PROJECT, TEST_SPACE } from './engines.ts';

const cfg = loadConfig();

describe.each(ENGINE_CASES)('file-breakdown (live, $name engine)', (ec) => {
  const run = `t${Date.now().toString(36)}${ec.name}`;
  const id2 = ec.ids[1];
  if (!cfg.jira || !cfg.confluence || !ec.available) {
    it.skip('needs the local DC stack and the engine installed', () => {});
    return;
  }
  let jira: JiraClient;
  let confluence: ConfluenceClient;
  let root: string;
  let breakdown: Breakdown;
  let epic = '';
  let prdId = '';

  beforeAll(async () => {
    ({ jira, confluence } = connect());
    root = mkdtempSync(join(tmpdir(), 'sdlc-filing-'));
    cpSync(ec.fixture, root, { recursive: true });
    breakdown = await ec.engine().loadBreakdown(root);
    epic = (await jira.createIssue({ project: TEST_PROJECT, issueType: 'Epic', summary: `${run} Reporting Improvements` })).key;
    prdId = (await confluence.createPage({ spaceKey: TEST_SPACE, title: `${run} PRD: Reporting Improvements`, markdown: '# PRD\n\nExport all the things.' })).id;
  });

  afterAll(async () => {
    for (const i of await jira.epicIssues(epic)) await jira.deleteIssue(i.key);
    await jira.deleteIssue(epic);
    for (const child of await confluence.children(prdId)) await confluence.deletePage(child.id);
    await confluence.deletePage(prdId);
    rmSync(root, { recursive: true, force: true });
  });

  const file = (dryRun = false) =>
    fileBreakdown({ jira, confluence, breakdown, epicKey: epic, prdPageId: prdId, state: new StateFile(root), dryRun });

  it('dry run changes nothing', async () => {
    const r = await file(true);
    expect(r.items.map((i) => i.action)).toEqual(['would-create', 'would-create', 'would-create']);
    expect(r.page?.action).toBe('would-create');
    expect(await jira.epicIssues(epic)).toHaveLength(0);
  });

  it('files stories in wave order with dependency links and a breakdown page under the PRD', async () => {
    const r = await file();
    expect(r.items.map((i) => [i.id, i.action, i.wave])).toEqual([
      [ec.ids[0], 'created', 1],
      [ec.ids[1], 'created', 2],
      [ec.ids[2], 'created', 2],
    ]);
    const [k1, k2, k3] = r.items.map((i) => i.key!);
    expect(r.links.map((l) => [l.from, l.to, l.action])).toEqual([
      [k1, k2, 'created'],
      [k1, k3, 'created'],
    ]);

    const story = (await jira.getIssue(k2!))!;
    expect(story.fields.labels).toEqual(expect.arrayContaining(['sdlc', `sdlc-item-${id2}`]));
    const md = JiraClient.descriptionMarkdown(story);
    expect(md).toContain('- [ ] Report viewer shows an Export button');
    expect(md).toContain('**Depends on:** CSV export endpoint');

    expect(r.page?.action).toBe('created');
    const page = (await confluence.getPage(r.page!.id!))!;
    expect(page.title).toBe(`Spec: ${run} Reporting Improvements - Ticket Breakdown`);
    expect(page.ancestors?.at(-1)?.id).toBe(prdId);
    const body = ConfluenceClient.markdown(page);
    expect(body).toContain(`**Wave 2 (parallel):** ${k2}, ${k3}`);
  });

  it('re-running is a no-op', async () => {
    const r = await file();
    expect(r.items.map((i) => i.action)).toEqual(['existing', 'existing', 'existing']);
    expect(r.links.every((l) => l.action === 'existing')).toBe(true);
    expect(r.page?.action).toBe('unchanged');
    expect(await jira.epicIssues(epic)).toHaveLength(3);
  });

  it('without the state file, adopts stories by label instead of duplicating', async () => {
    rmSync(join(root, '.sdlc'), { recursive: true, force: true });
    const r = await file();
    expect(r.items.map((i) => i.action)).toEqual(['adopted', 'adopted', 'adopted']);
    expect(await jira.epicIssues(epic)).toHaveLength(3);
  });

  it('adopts a human-created story with the same summary (reference duplicate check)', async () => {
    const epic2 = (await jira.createIssue({ project: TEST_PROJECT, issueType: 'Epic', summary: `${run} second epic` })).key;
    const manual = (await jira.createIssue({ project: TEST_PROJECT, issueType: 'Story', summary: 'export ui', epicKey: epic2 })).key;
    const root2 = mkdtempSync(join(tmpdir(), 'sdlc-filing-'));
    try {
      const r = await fileBreakdown({ jira, breakdown, epicKey: epic2, state: new StateFile(root2) });
      expect(r.items.find((i) => i.id === id2)).toMatchObject({ key: manual, action: 'adopted' });
      expect((await jira.getIssue(manual))!.fields.labels).toContain(`sdlc-item-${id2}`);
    } finally {
      for (const i of await jira.epicIssues(epic2)) await jira.deleteIssue(i.key);
      await jira.deleteIssue(epic2);
      rmSync(root2, { recursive: true, force: true });
    }
  });

  it('refuses to file the same repo under a different epic', async () => {
    await expect(fileBreakdown({ jira, breakdown, epicKey: 'SDLC-999999', state: new StateFile(root) })).rejects.toThrow();
    const other = (await jira.createIssue({ project: TEST_PROJECT, issueType: 'Epic', summary: `${run} other` })).key;
    try {
      await expect(fileBreakdown({ jira, breakdown, epicKey: other, state: new StateFile(root) })).rejects.toThrow(/already filed under/);
    } finally {
      await jira.deleteIssue(other);
    }
  });
});
