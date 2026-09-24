import { createHash } from 'node:crypto';
import { HttpClient } from './http.ts';
import { markdownToStorage, storageToMarkdown } from './markup.ts';
import type { ProductConfig } from './config.ts';

export type ConfluencePage = {
  id: string;
  type: string;
  title: string;
  space?: { key: string };
  version?: { number: number };
  body?: { storage?: { value: string } };
  ancestors?: { id: string; title: string }[];
  _links: { webui: string; base?: string };
};

const EXPAND = 'body.storage,version,space,ancestors';

/** Confluence Data Center REST client (content API). Markdown in, markdown out. */
export class ConfluenceClient {
  readonly http: HttpClient;

  constructor(config: ProductConfig) {
    this.http = new HttpClient(config.baseUrl, config.token);
  }

  get baseUrl() {
    return this.http.baseUrl;
  }

  pageUrl(page: ConfluencePage) {
    return this.http.baseUrl + page._links.webui;
  }

  currentUser() {
    return this.http.get<{ username: string; displayName: string }>('/rest/api/user/current');
  }

  getPage(id: string): Promise<ConfluencePage | undefined> {
    return this.http.get<ConfluencePage>(`/rest/api/content/${encodeURIComponent(id)}`, { expand: EXPAND }, [404]);
  }

  async findPage(spaceKey: string, title: string): Promise<ConfluencePage | undefined> {
    const r = await this.http.get<{ results: ConfluencePage[] }>('/rest/api/content', { spaceKey, title, type: 'page', expand: EXPAND });
    return r.results[0];
  }

  /** Page body as markdown. */
  static markdown(page: ConfluencePage): string {
    return storageToMarkdown(page.body?.storage?.value ?? '');
  }

  async search(cql: string, limit = 25): Promise<ConfluencePage[]> {
    const r = await this.http.get<{ results: ConfluencePage[] }>('/rest/api/content/search', { cql, limit, expand: 'space,version' });
    return r.results;
  }

  children(pageId: string) {
    return this.http
      .get<{ results: ConfluencePage[] }>(`/rest/api/content/${encodeURIComponent(pageId)}/child/page`, { limit: 200, expand: 'version' })
      .then((r) => r.results);
  }

  createPage(opts: { spaceKey: string; title: string; markdown: string; parentId?: string }): Promise<ConfluencePage> {
    return this.http.post('/rest/api/content', {
      type: 'page',
      title: opts.title,
      space: { key: opts.spaceKey },
      ...(opts.parentId ? { ancestors: [{ id: opts.parentId }] } : {}),
      body: { storage: { value: markdownToStorage(opts.markdown), representation: 'storage' } },
    });
  }

  async updatePage(id: string, opts: { title?: string; markdown: string; message?: string }): Promise<ConfluencePage> {
    const current = await this.getPage(id);
    if (!current) throw new Error(`Confluence page ${id} not found`);
    return this.http.put(`/rest/api/content/${encodeURIComponent(id)}`, {
      type: 'page',
      title: opts.title ?? current.title,
      version: { number: (current.version?.number ?? 0) + 1, ...(opts.message ? { message: opts.message } : {}) },
      body: { storage: { value: markdownToStorage(opts.markdown), representation: 'storage' } },
    });
  }

  async deletePage(id: string) {
    await this.http.request('DELETE', `/rest/api/content/${encodeURIComponent(id)}`, { tolerate: [404] });
  }

  /**
   * Create or update the page with this title in the space. Skips the write (no new version) when the
   * source markdown is unchanged since our last write, so repeated syncs don't spam page history.
   * Confluence re-serialises storage XHTML, so we compare a hash of the *source*, kept in a page property.
   */
  async upsertPage(opts: { spaceKey: string; title: string; markdown: string; parentId?: string }) {
    const hash = sourceHash(opts.markdown);
    const existing = await this.findPage(opts.spaceKey, opts.title);
    if (!existing) {
      const page = await this.createPage(opts);
      await this.setProperty(page.id, HASH_PROPERTY, hash);
      return { page, action: 'created' as const };
    }
    if ((await this.getProperty(existing.id, HASH_PROPERTY)) === hash) return { page: existing, action: 'unchanged' as const };
    const page = await this.updatePage(existing.id, { markdown: opts.markdown });
    await this.setProperty(page.id, HASH_PROPERTY, hash);
    return { page, action: 'updated' as const };
  }

  async getProperty(pageId: string, key: string): Promise<unknown> {
    const p = await this.http.get<{ value: unknown }>(`/rest/api/content/${encodeURIComponent(pageId)}/property/${encodeURIComponent(key)}`, undefined, [404]);
    return p?.value;
  }

  async setProperty(pageId: string, key: string, value: unknown) {
    const path = `/rest/api/content/${encodeURIComponent(pageId)}/property/${encodeURIComponent(key)}`;
    const current = await this.http.get<{ version: { number: number } }>(path, undefined, [404]);
    if (current) await this.http.put(path, { key, value, version: { number: current.version.number + 1 } });
    else await this.http.post(`/rest/api/content/${encodeURIComponent(pageId)}/property`, { key, value });
  }
}

const HASH_PROPERTY = 'sdlc-source-hash';

function sourceHash(markdown: string) {
  return createHash('sha256').update(markdown).digest('hex');
}
