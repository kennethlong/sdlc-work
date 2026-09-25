// Slice 5 end to end, for every engine: Track B import -> progress sync, bug RCA publishing, escalation.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect, ConfluenceClient, escalateTicket, importTicket, JiraClient, loadConfig, publishRca, resolveEngine, StateFile, syncProgress } from '../src/index.ts';
import { ENGINE_CASES } from './engines.ts';

const cfg = loadConfig();

describe.each(ENGINE_CASES)('Track B (live, $name engine)', (ec) => {
  const run = `t${Date.now().toString(36)}${ec.name}`;
  if (!cfg.jira || !cfg.confluence || !ec.available) {
    it.skip('needs the local DC stack and the engine installed', () => {});
    return;
  }

  let jira: JiraClient;
  let confluence: ConfluenceClient;
  let root: string;
  let story = '';
  let bug = '';
  const created: string[] = [];
  const pages: string[] = [];

  const state = () => new StateFile(root);
  const sync = () =>
    syncProgress({ jira, confluence, root, state: state(), engineFor: (name) => resolveEngine(root, name ?? ec.name), confluenceSpace: 'SDLC' });
  const status = async (key: string) => (await jira.getIssue(key, 'status'))!.fields.status!.name;

  beforeAll(async () => {
    ({ jira, confluence } = connect());
    root = mkdtempSync(join(tmpdir(), 'sdlc-trackb-'));
    story = (
      await jira.createIssue({
        project: 'SDLC',
        issueType: 'Story',
        summary: `${run} Export button`,
        description: 'Add an export button.\n\n## Acceptance criteria\n\n- Button visible with read access\n- Download starts within 2s',
      })
    ).key;
    bug = (await jira.createIssue({ project: 'SDLC', issueType: 'Bug', summary: `${run} Export crashes on empty report` })).key;
    created.push(story, bug);
    await jira.addComment(story, 'Please match the **viewer** toolbar style.');
  });

  afterAll(async () => {
    for (const k of created) await jira.deleteIssue(k);
    for (const p of pages) await confluence.deletePage(p);
    rmSync(root, { recursive: true, force: true });
  });

  it('import writes an engine-aware brief with acceptance criteria and comments', async () => {
    const r = await importTicket({ jira, root, key: story, engine: ec.engine(), state: state() });
    expect(r).toMatchObject({ key: story, type: 'Story', isBug: false });
    const brief = readFileSync(r.brief, 'utf8');
    expect(brief).toMatch(new RegExp(`^---\\nkey: ${story}\\ntype: Story\\n`));
    expect(brief).toContain('- [ ] Button visible with read access');
    expect(brief).toContain('match the **viewer** toolbar style');
    expect(brief).toContain(`engine: ${ec.name}`);
    expect(state().data.tickets?.[story]).toMatchObject({ type: 'Story', engine: ec.name });
  });

  it('sync follows the ticket: not started -> In Progress -> Done with a published verification', async () => {
    let r = await sync();
    expect(r.tickets.find((t) => t.key === story)).toMatchObject({ status: 'not_started', transition: { action: 'none' } });

    ec.planTicket(root, story);
    r = await sync();
    expect(r.tickets.find((t) => t.key === story)).toMatchObject({ status: 'planned', transition: { action: 'moved' } });
    expect(await status(story)).toBe('In Progress');

    ec.passTicket(root, story);
    r = await sync();
    const t = r.tickets.find((x) => x.key === story)!;
    expect(t).toMatchObject({ status: 'complete', transition: { action: 'moved' }, report: { action: 'created' } });
    expect(await status(story)).toBe('Done');
    const page = (await confluence.findPage('SDLC', `Verification: ${story} ${run} Export button`))!;
    pages.push(page.id);
    expect((await jira.comments(story)).at(-1)!.body).toMatch(/^Verification \*passed\*/);

    r = await sync(); // idempotent
    expect(r.tickets.find((x) => x.key === story)).toMatchObject({ transition: { action: 'already' }, report: { action: 'unchanged' } });
  });

  it('bugs get RCA next steps; publish-rca posts once, warns on a missing learning loop', async () => {
    const imp = await importTicket({ jira, root, key: bug, engine: ec.engine(), state: state() });
    expect(imp.isBug).toBe(true);
    expect(readFileSync(imp.brief, 'utf8')).toContain(`/rca ${bug}`);

    mkdirSync(join(root, 'docs', 'rca'), { recursive: true });
    const rcaFile = join(root, 'docs', 'rca', `${bug}.md`);
    writeFileSync(
      rcaFile,
      [
        `# Root Cause Analysis: ${bug}`,
        '',
        '## Root Cause',
        '',
        '### Analysis',
        '',
        '`buildRows()` assumes at least one row and indexes `rows[0]` to derive headers.',
        '',
        '## Proposed Fix',
        '',
        '### Fix Strategy',
        '',
        'Derive headers from the report schema, not the first row.',
      ].join('\n'),
    );
    const first = await publishRca({ jira, confluence, root, key: bug, spaceKey: 'SDLC', state: state() });
    pages.push(first.page.id);
    expect(first.page.action).toBe('created');
    expect(first.commented).toBe(true);
    expect(first.warnings.join(' ')).toMatch(/regression test/);
    expect(first.warnings.join(' ')).toMatch(/Prevention/);
    const comment = (await jira.comments(bug)).at(-1)!.body;
    expect(comment).toContain('Root cause analysis');
    expect(comment).toContain('{{rows[0]}}');
    expect(comment).toContain('Derive headers from the report schema');

    const again = await publishRca({ jira, confluence, root, key: bug, spaceKey: 'SDLC', state: state() });
    expect(again).toMatchObject({ commented: false, page: { action: 'unchanged' } });

    writeFileSync(rcaFile, readFileSync(rcaFile, 'utf8') + '\n\n## Prevention\n\n- Rule: exporters derive headers from the schema.\n- Regression test: `export.empty.test.ts`.\n');
    const fixed = await publishRca({ jira, confluence, root, key: bug, spaceKey: 'SDLC', state: state() });
    expect(fixed).toMatchObject({ commented: true, page: { action: 'updated' }, warnings: [] });

    const parent = (await confluence.findPage('SDLC', 'Root Cause Analyses'))!;
    expect((await confluence.getPage(first.page.id))!.ancestors?.at(-1)?.id).toBe(parent.id);
  });

  it('escalate links the ticket to an epic and takes it out of Track B sync', async () => {
    const epic = (await jira.createIssue({ project: 'SDLC', issueType: 'Epic', summary: `${run} bigger than it looked` })).key;
    created.push(epic);
    await escalateTicket({ jira, key: bug, epic, state: state() });
    expect((await jira.epicIssues(epic)).map((i) => i.key)).toContain(bug);
    expect((await jira.comments(bug)).at(-1)!.body).toContain('Escalated to Track A');
    const r = await sync();
    expect(r.tickets.map((t) => t.key)).not.toContain(bug);
    expect(existsSync(join(root, '.sdlc', 'tickets', `${bug}.md`))).toBe(true);
  });
});
