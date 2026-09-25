// Integration tests against the local DC stack (infra/atlassian-dc). Run: npm run test:live
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, ConfluenceClient, JiraClient, loadConfig } from '../src/index.ts';

const cfg = loadConfig();
const run = `t${Date.now().toString(36)}`;
const PROJECT = process.env.SDLC_TEST_PROJECT ?? 'SDLC';
const SPACE = process.env.SDLC_TEST_SPACE ?? 'SDLC';

describe.skipIf(!cfg.jira)('Jira DC', () => {
  let jira: JiraClient;
  beforeAll(() => {
    jira = connect().jira;
  });
  const created: string[] = [];
  let epic = '';
  let story = '';

  afterAll(async () => {
    for (const key of created.reverse()) await jira.deleteIssue(key);
  });

  it('authenticates with the PAT', async () => {
    expect((await jira.myself()).name).toBeTruthy();
  });

  it('creates an epic and a story linked to it, with markdown description', async () => {
    epic = (await jira.createIssue({ project: PROJECT, issueType: 'Epic', summary: `${run} epic` })).key;
    created.push(epic);
    story = (
      await jira.createIssue({
        project: PROJECT,
        issueType: 'Story',
        summary: `${run} story`,
        epicKey: epic,
        labels: ['sdlc-test'],
        description: '## Acceptance criteria\n\n- [ ] exports CSV\n- [ ] escapes `=HYPERLINK`\n\n```ts\nconst x = 1;\n```',
      })
    ).key;
    created.push(story);

    const issue = (await jira.getIssue(story))!;
    const md = JiraClient.descriptionMarkdown(issue);
    expect(md).toContain('## Acceptance criteria');
    expect(md).toContain('`=HYPERLINK`');
    expect(md).toContain('```ts\nconst x = 1;\n```');
    expect(issue.fields.labels).toEqual(['sdlc-test']);
  });

  it('lists epic children and finds them by JQL', async () => {
    expect((await jira.epicIssues(epic)).map((i) => i.key)).toEqual([story]);
    const found = await jira.search(`project = ${PROJECT} AND labels = sdlc-test AND summary ~ "${run}"`, { fields: ['summary'] });
    expect(found.map((i) => i.key)).toContain(story);
  });

  it('transitions idempotently by status name', async () => {
    expect(await jira.transitionTo(story, 'In Progress')).toBe(true);
    expect(await jira.transitionTo(story, 'in progress')).toBe(true); // already there: no-op
    expect(await jira.transitionTo(story, 'Done')).toBe(true);
    expect((await jira.getIssue(story, 'status'))!.fields.status!.name).toBe('Done');
    expect(await jira.transitionTo(story, 'No Such Status')).toBe(false);
  });

  it('links issues in the stated direction', async () => {
    await jira.linkIssues('Blocks', epic, story); // "epic blocks story"
    const links = (await jira.getIssue(story, 'issuelinks'))!.fields.issuelinks as { type: { inward: string }; inwardIssue?: { key: string } }[];
    // Seen from the story: "<story> is blocked by <epic>".
    expect(links).toContainEqual(expect.objectContaining({ type: expect.objectContaining({ inward: 'is blocked by' }), inwardIssue: expect.objectContaining({ key: epic }) }));
  });

  it('comments in markdown and adds remote links', async () => {
    await jira.addComment(story, 'Verified: **all green**');
    const comments = await jira.comments(story);
    expect(comments.at(-1)!.body).toBe('Verified: *all green*');
    await jira.addRemoteLink(story, 'https://example.com/pr/1', 'PR #1');
    await jira.addRemoteLink(story, 'https://example.com/pr/1', 'PR #1 (renamed)'); // same globalId: updates
    const links = await jira.http.get<unknown[]>(`/rest/api/2/issue/${story}/remotelink`);
    expect(links).toHaveLength(1);
  });
});

describe.skipIf(!cfg.confluence)('Confluence DC', () => {
  let confluence: ConfluenceClient;
  beforeAll(() => {
    confluence = connect().confluence;
  });
  const title = `${run} verification report`;
  let pageId = '';

  afterAll(async () => {
    if (pageId) await confluence.deletePage(pageId);
  });

  it('authenticates with the PAT', async () => {
    expect((await confluence.currentUser()).username).toBeTruthy();
  });

  it('upserts: create, unchanged, update', async () => {
    const md = '# Report\n\n| Check | Result |\n|---|---|\n| tests | pass |\n\n```bash\nnpm test\n```';
    const a = await confluence.upsertPage({ spaceKey: SPACE, title, markdown: md });
    expect(a.action).toBe('created');
    pageId = a.page.id;

    const b = await confluence.upsertPage({ spaceKey: SPACE, title, markdown: md });
    expect(b.action).toBe('unchanged');

    const c = await confluence.upsertPage({ spaceKey: SPACE, title, markdown: md + '\n\nAddendum.' });
    expect(c.action).toBe('updated');
    expect(c.page.version!.number).toBe(2);
  });

  it('reads pages back as markdown, including code macros', async () => {
    const md = ConfluenceClient.markdown((await confluence.getPage(pageId))!);
    expect(md).toContain('# Report');
    expect(md).toContain('```bash\nnpm test\n```');
    expect(md).toContain('Addendum.');
    expect(md).toMatch(/\|\s*tests\s*\|\s*pass\s*\|/);
  });

  // Search indexing is async: well under a second on DC, ~40s measured on Cloud.
  it('finds pages by CQL (search index is async)', { timeout: 180_000 }, async () => {
    await expect
      .poll(async () => (await confluence.search(`space = ${SPACE} AND title = "${title}"`)).map((p) => p.id), { timeout: 150_000, interval: 3000 })
      .toContain(pageId);
  });
});
