/**
 * Confluence Cloud client: the v1 content endpoints are gone from Cloud's spec (deprecated 2024–25), so pages,
 * children and content properties use the v2 API (`/wiki/api/v2`). CQL search and the current user stay on v1,
 * which still documents them. Pages are normalised to the DC `ConfluencePage` shape so the shared logic
 * (upsert with source hash, previews, markdown) works unchanged.
 *
 * Base URL must include `/wiki`: https://<site>.atlassian.net/wiki
 */
import { markdownToStorage } from './markup.ts';
import { ConfluenceClient, type ConfluencePage } from './confluence.ts';

type V2Page = {
  id: string;
  status: string;
  title: string;
  spaceId: string;
  parentId?: string | null;
  version?: { number: number };
  body?: { storage?: { value: string } };
  _links: { webui: string; base?: string };
};
type V2Property = { id: string; key: string; value: unknown; version: { number: number } };

export class ConfluenceCloudClient extends ConfluenceClient {
  private readonly spaceIds = new Map<string, Promise<string>>();
  private readonly spaceKeys = new Map<string, Promise<string>>();

  override async currentUser() {
    const u = await this.http.get<{ accountId: string; displayName?: string; publicName?: string; email?: string }>('/rest/api/user/current');
    return { username: u.email || u.publicName || u.accountId, displayName: u.displayName ?? u.publicName ?? '' };
  }

  override async getPage(id: string): Promise<ConfluencePage | undefined> {
    const p = await this.http.get<V2Page>(`/api/v2/pages/${encodeURIComponent(id)}`, { 'body-format': 'storage' }, [404]);
    return p && this.normalize(p);
  }

  override async findPage(spaceKey: string, title: string): Promise<ConfluencePage | undefined> {
    const r = await this.http.get<{ results: V2Page[] }>('/api/v2/pages', {
      'space-id': await this.spaceId(spaceKey),
      title,
      status: 'current',
      'body-format': 'storage',
    });
    return r.results[0] && this.normalize(r.results[0], spaceKey);
  }

  override async search(cql: string, limit = 25): Promise<ConfluencePage[]> {
    const r = await this.http.get<{ results: { content?: { id: string; type: string; title: string; _links: { webui: string } } }[] }>('/rest/api/search', { cql, limit });
    return r.results.flatMap((x) => (x.content ? [{ id: x.content.id, type: x.content.type, title: x.content.title, _links: x.content._links }] : []));
  }

  override async children(pageId: string): Promise<ConfluencePage[]> {
    const r = await this.http.get<{ results: { id: string; title: string; type?: string }[] }>(`/api/v2/pages/${encodeURIComponent(pageId)}/direct-children`, { limit: 250 });
    return r.results.map((c) => ({ id: c.id, type: c.type ?? 'page', title: c.title, _links: { webui: `/pages/viewpage.action?pageId=${c.id}` } }));
  }

  override async createPage(opts: { spaceKey: string; title: string; markdown: string; parentId?: string }): Promise<ConfluencePage> {
    const p = await this.http.post<V2Page>('/api/v2/pages', {
      spaceId: await this.spaceId(opts.spaceKey),
      status: 'current',
      title: opts.title,
      ...(opts.parentId ? { parentId: opts.parentId } : {}),
      body: { representation: 'storage', value: markdownToStorage(opts.markdown) },
    });
    return this.normalize(p, opts.spaceKey);
  }

  override async updatePage(id: string, opts: { title?: string; markdown: string; message?: string }): Promise<ConfluencePage> {
    const current = await this.getPage(id);
    if (!current) throw new Error(`Confluence page ${id} not found`);
    const p = await this.http.put<V2Page>(`/api/v2/pages/${encodeURIComponent(id)}`, {
      id,
      status: 'current',
      title: opts.title ?? current.title,
      body: { representation: 'storage', value: markdownToStorage(opts.markdown) },
      version: { number: (current.version?.number ?? 0) + 1, ...(opts.message ? { message: opts.message } : {}) },
    });
    return this.normalize(p, current.space?.key);
  }

  override async deletePage(id: string) {
    await this.http.request('DELETE', `/api/v2/pages/${encodeURIComponent(id)}`, { tolerate: [404] });
  }

  // v2 content properties are addressed by numeric id; the only lookup by key is the list filter.
  private async property(pageId: string, key: string): Promise<V2Property | undefined> {
    const r = await this.http.get<{ results: V2Property[] }>(`/api/v2/pages/${encodeURIComponent(pageId)}/properties`, { key });
    return r.results.find((p) => p.key === key);
  }

  override async getProperty(pageId: string, key: string): Promise<unknown> {
    return (await this.property(pageId, key))?.value;
  }

  override async setProperty(pageId: string, key: string, value: unknown) {
    const existing = await this.property(pageId, key);
    const base = `/api/v2/pages/${encodeURIComponent(pageId)}/properties`;
    if (existing) await this.http.put(`${base}/${existing.id}`, { key, value, version: { number: existing.version.number + 1 } });
    else await this.http.post(base, { key, value });
  }

  async spaceId(spaceKey: string): Promise<string> {
    let id = this.spaceIds.get(spaceKey);
    if (!id) {
      id = this.http.get<{ results: { id: string; key: string }[] }>('/api/v2/spaces', { keys: spaceKey }).then((r) => {
        const s = r.results.find((x) => x.key === spaceKey);
        if (!s) throw new Error(`Confluence space ${spaceKey} not found`);
        return s.id;
      });
      this.spaceIds.set(spaceKey, id);
    }
    return id;
  }

  private spaceKey(spaceId: string): Promise<string> {
    let key = this.spaceKeys.get(spaceId);
    if (!key) {
      key = this.http.get<{ key: string }>(`/api/v2/spaces/${encodeURIComponent(spaceId)}`).then((s) => s.key);
      this.spaceKeys.set(spaceId, key);
    }
    return key;
  }

  private async normalize(p: V2Page, spaceKey?: string): Promise<ConfluencePage> {
    return {
      id: p.id,
      type: 'page',
      title: p.title,
      space: { key: spaceKey ?? (await this.spaceKey(p.spaceId)) },
      version: p.version,
      body: p.body?.storage ? { storage: { value: p.body.storage.value } } : undefined,
      ancestors: p.parentId ? [{ id: p.parentId }] : [],
      _links: p._links,
    };
  }
}
