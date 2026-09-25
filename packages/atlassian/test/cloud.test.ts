// Contract tests for the Cloud flavor against an in-memory fake of the documented Cloud APIs (Jira v2 + search/jql,
// Confluence v2). The fake rejects removed endpoints (410) the way Cloud does, so a regression to DC-only calls fails.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfluenceCloudClient } from '../src/confluence-cloud.ts';
import { JiraClient } from '../src/jira.ts';
import type { ProductConfig } from '../src/config.ts';

type Call = { method: string; path: string; query: URLSearchParams; body: any; auth: string | null };
type Handler = (c: Call) => { status?: number; json?: unknown } | undefined;

let calls: Call[] = [];
function fakeFetch(handler: Handler) {
  vi.stubGlobal('fetch', async (input: URL | string, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const call: Call = {
      method: init.method ?? 'GET',
      path: url.pathname,
      query: url.searchParams,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      auth: new Headers(init.headers).get('authorization'),
    };
    calls.push(call);
    const r = handler(call) ?? { status: 404, json: { message: `fake: no route ${call.method} ${call.path}` } };
    return new Response(r.json === undefined ? null : JSON.stringify(r.json), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  });
}
beforeEach(() => (calls = []));
afterEach(() => vi.unstubAllGlobals());

const auth = { type: 'basic', user: 'me@acme.com', token: 't' } as const;

describe('Jira Cloud', () => {
  const cfg: ProductConfig = { baseUrl: 'https://acme.atlassian.net', flavor: 'cloud', auth };

  it('searches with /search/jql token pagination (old /search is gone) and asks for fields', async () => {
    fakeFetch((c) => {
      if (c.path === '/rest/api/2/search') return { status: 410, json: { errorMessages: ['removed'] } };
      if (c.path !== '/rest/api/2/search/jql') return;
      expect(c.query.get('fields')).toBe('*navigable');
      const token = c.query.get('nextPageToken');
      return !token
        ? { json: { issues: [{ key: 'A-1', fields: {} }], nextPageToken: 'p2', isLast: false } }
        : { json: { issues: [{ key: 'A-2', fields: {} }], isLast: true } };
    });
    const jira = new JiraClient(cfg);
    expect((await jira.search('project = A')).map((i) => i.key)).toEqual(['A-1', 'A-2']);
    expect(calls[0]!.auth).toBe('Basic ' + Buffer.from('me@acme.com:t').toString('base64'));
  });

  it('uses parent for epics: create, list children, set, read back', async () => {
    fakeFetch((c) => {
      if (c.path === '/rest/api/2/field') return { json: [] }; // no "Epic Link" on Cloud
      if (c.method === 'POST' && c.path === '/rest/api/2/issue') return { status: 201, json: { id: '10', key: 'A-5' } };
      if (c.path === '/rest/api/2/search/jql') return { json: { issues: [{ key: 'A-5', fields: {} }], isLast: true } };
      if (c.method === 'PUT' && c.path === '/rest/api/2/issue/A-6') return { status: 204 };
      if (c.path === '/rest/api/2/issue/A-6') return { json: { key: 'A-6', fields: { parent: { key: 'A-1', fields: { issuetype: { name: 'Epic', hierarchyLevel: 1 } } } } } };
      if (c.path === '/rest/agile/1.0/epic/A-1/issue') return { status: 410 };
    });
    const jira = new JiraClient(cfg);
    await jira.createIssue({ project: 'A', issueType: 'Story', summary: 's', epicKey: 'A-1' });
    expect(calls.at(-1)!.body.fields.parent).toEqual({ key: 'A-1' });

    await jira.createIssue({ project: 'A', issueType: 'Epic', summary: 'e' });
    expect(Object.keys(calls.at(-1)!.body.fields).filter((k) => k.startsWith('customfield'))).toEqual([]); // no Epic Name

    expect((await jira.epicIssues('A-1')).map((i) => i.key)).toEqual(['A-5']);
    expect(calls.at(-1)!.query.get('jql')).toBe('parent = A-1 ORDER BY created ASC');

    await jira.setEpic('A-6', 'A-1');
    expect(calls.at(-1)!.body).toEqual({ fields: { parent: { key: 'A-1' } } });
    expect(await jira.epicOf('A-6')).toBe('A-1');
  });

  it('reports the accountId as the user name (Cloud has no usernames)', async () => {
    fakeFetch((c) => (c.path === '/rest/api/2/myself' ? { json: { accountId: '5b10ac', displayName: 'Me', name: '' } } : undefined));
    expect((await new JiraClient(cfg).myself()).name).toBe('5b10ac');
  });
});

describe('Confluence Cloud (v2)', () => {
  const cfg: ProductConfig = { baseUrl: 'https://acme.atlassian.net/wiki', flavor: 'cloud', auth };

  /** Minimal in-memory Confluence v2: one space, pages with versions, content properties by numeric id. */
  function fakeConfluence() {
    const pages = new Map<string, { id: string; title: string; spaceId: string; parentId?: string; version: number; body: string }>();
    const props = new Map<string, { id: string; pageId: string; key: string; value: unknown; version: number }>();
    let seq = 100;
    const view = (p: ReturnType<typeof pages.get> & object) => ({
      id: p.id,
      status: 'current',
      title: p.title,
      spaceId: p.spaceId,
      parentId: p.parentId ?? null,
      version: { number: p.version },
      body: { storage: { representation: 'storage', value: p.body } },
      _links: { webui: `/spaces/DOC/pages/${p.id}`, base: 'https://acme.atlassian.net/wiki' },
    });
    fakeFetch((c) => {
      const m = c.path.match(/^\/wiki\/api\/v2\/(.*)$/);
      if (c.path.startsWith('/wiki/rest/api/content')) return { status: 410, json: { message: 'removed' } };
      if (!m) return;
      const route = m[1]!;
      if (route === 'spaces') return { json: { results: c.query.get('keys') === 'DOC' ? [{ id: '42', key: 'DOC' }] : [] } };
      if (route === 'spaces/42') return { json: { id: '42', key: 'DOC' } };
      if (route === 'pages' && c.method === 'GET') {
        const hit = [...pages.values()].filter((p) => p.spaceId === c.query.get('space-id') && p.title === c.query.get('title'));
        return { json: { results: hit.map(view) } };
      }
      if (route === 'pages' && c.method === 'POST') {
        expect(c.body).toMatchObject({ spaceId: '42', status: 'current', body: { representation: 'storage' } });
        const p = { id: String(++seq), title: c.body.title, spaceId: c.body.spaceId, parentId: c.body.parentId, version: 1, body: c.body.body.value };
        pages.set(p.id, p);
        return { json: view(p) };
      }
      let pm = route.match(/^pages\/(\d+)$/);
      if (pm) {
        const p = pages.get(pm[1]!);
        if (!p) return { status: 404, json: {} };
        if (c.method === 'GET') return { json: view(p) };
        if (c.method === 'PUT') {
          expect(c.body.version.number).toBe(p.version + 1);
          Object.assign(p, { title: c.body.title, body: c.body.body.value, version: c.body.version.number });
          return { json: view(p) };
        }
        if (c.method === 'DELETE') return pages.delete(p.id), { status: 204 };
      }
      pm = route.match(/^pages\/(\d+)\/properties(?:\/(\d+))?$/);
      if (pm) {
        const [, pageId, propId] = pm;
        if (c.method === 'GET') return { json: { results: [...props.values()].filter((x) => x.pageId === pageId && x.key === c.query.get('key')).map((x) => ({ ...x, version: { number: x.version } })) } };
        if (c.method === 'POST') {
          const x = { id: String(++seq), pageId: pageId!, key: c.body.key, value: c.body.value, version: 1 };
          props.set(x.id, x);
          return { json: { ...x, version: { number: 1 } } };
        }
        if (c.method === 'PUT') {
          const x = props.get(propId!)!;
          expect(c.body.version.number).toBe(x.version + 1);
          Object.assign(x, { value: c.body.value, version: c.body.version.number });
          return { json: { ...x, version: { number: x.version } } };
        }
      }
    });
    return { pages };
  }

  it('upserts via v2 with the source-hash property: created -> unchanged -> updated', async () => {
    const { pages } = fakeConfluence();
    const conf = new ConfluenceCloudClient(cfg);
    const a = await conf.upsertPage({ spaceKey: 'DOC', title: 'Report', markdown: '# Hi\n\n```ts\nx\n```', parentId: '7' });
    expect(a.action).toBe('created');
    expect(pages.get(a.page.id)!.parentId).toBe('7');
    expect(a.page.space?.key).toBe('DOC');
    expect(conf.pageUrl(a.page)).toBe(`https://acme.atlassian.net/wiki/spaces/DOC/pages/${a.page.id}`);

    expect(await conf.upsertPreview({ spaceKey: 'DOC', title: 'Report', markdown: '# Hi\n\n```ts\nx\n```' })).toBe('unchanged');
    expect((await conf.upsertPage({ spaceKey: 'DOC', title: 'Report', markdown: '# Hi\n\n```ts\nx\n```' })).action).toBe('unchanged');

    const c = await conf.upsertPage({ spaceKey: 'DOC', title: 'Report', markdown: '# Hi v2' });
    expect(c.action).toBe('updated');
    expect(c.page.version?.number).toBe(2);
    expect(pages.get(a.page.id)!.body).toContain('Hi v2');
    expect(calls.some((x) => x.path.startsWith('/wiki/rest/api/content'))).toBe(false);
  });

  it('reads pages back as markdown with the parent as the last ancestor', async () => {
    fakeConfluence();
    const conf = new ConfluenceCloudClient(cfg);
    const { page } = await conf.upsertPage({ spaceKey: 'DOC', title: 'P', markdown: '**bold**', parentId: '9' });
    const got = (await conf.getPage(page.id))!;
    expect(got.ancestors?.at(-1)?.id).toBe('9');
    expect(ConfluenceCloudClient.markdown(got)).toBe('**bold**');
  });
});
