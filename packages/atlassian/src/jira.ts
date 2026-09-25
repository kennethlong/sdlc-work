import { HttpClient, type Query } from './http.ts';
import { jiraWikiToMarkdown, markdownToJiraWiki } from './markup.ts';
import type { Flavor, ProductConfig } from './config.ts';

export type JiraIssue = {
  id: string;
  key: string;
  self: string;
  fields: Record<string, any> & {
    summary: string;
    status?: { name: string; statusCategory?: { key: string } };
    issuetype?: { name: string; subtask?: boolean };
    description?: string | null;
    labels?: string[];
  };
};

export type NewIssue = {
  project: string;
  issueType: string;
  summary: string;
  /** Markdown; converted to Jira wiki markup. */
  description?: string;
  labels?: string[];
  /** Links a story/task to its epic (DC "Epic Link" field). */
  epicKey?: string;
  /** Required for sub-tasks. */
  parentKey?: string;
  /** Raw extra fields, by field id. */
  fields?: Record<string, unknown>;
};

type Field = { id: string; name: string; custom: boolean; schema?: { custom?: string } };

/**
 * Jira REST client (API v2: wiki-markup rich text on both flavors). Markdown in, markdown out.
 * Data Center and Cloud differ in: search (`/search` vs `/search/jql` with page tokens), epics ("Epic Link"
 * field + Agile API vs `parent`), and user identity (`name` vs `accountId`).
 */
export class JiraClient {
  readonly http: HttpClient;
  readonly flavor: Flavor;
  private fieldsCache?: Promise<Field[]>;

  constructor(config: ProductConfig) {
    this.http = new HttpClient(config.baseUrl, config.auth);
    this.flavor = config.flavor;
  }

  get baseUrl() {
    return this.http.baseUrl;
  }

  browseUrl(key: string) {
    return `${this.http.baseUrl}/browse/${key}`;
  }

  /** The authenticated user. `name` is the DC username, or the Cloud accountId (Cloud has no usernames). */
  async myself(): Promise<{ name: string; displayName: string; emailAddress?: string; accountId?: string }> {
    const me = await this.http.get<{ name?: string; accountId?: string; displayName: string; emailAddress?: string }>('/rest/api/2/myself');
    return { ...me, name: me.name || me.accountId || '' };
  }

  async getIssue(key: string, fields = '*navigable'): Promise<JiraIssue | undefined> {
    return this.http.get<JiraIssue>(`/rest/api/2/issue/${encodeURIComponent(key)}`, { fields }, [404]);
  }

  /** Issue description as markdown. */
  static descriptionMarkdown(issue: JiraIssue): string {
    return jiraWikiToMarkdown(issue.fields.description ?? '');
  }

  /** Any wiki-markup field (e.g. a comment body) as markdown. */
  static wikiToMarkdown(wiki: string): string {
    return jiraWikiToMarkdown(wiki ?? '');
  }

  /** Run a JQL search, following pagination. */
  async search(jql: string, opts: { fields?: string[]; limit?: number } = {}): Promise<JiraIssue[]> {
    const out: JiraIssue[] = [];
    const limit = opts.limit ?? Infinity;
    if (this.flavor === 'cloud') {
      // Cloud removed /search (410 Gone); /search/jql pages with tokens and returns only `id` unless asked.
      for (let token: string | undefined; out.length < limit; ) {
        const query: Query = { jql, maxResults: Math.min(100, limit - out.length), fields: opts.fields?.join(',') ?? '*navigable', nextPageToken: token };
        const page = await this.http.get<{ issues: JiraIssue[]; nextPageToken?: string; isLast?: boolean }>('/rest/api/2/search/jql', query);
        out.push(...page.issues);
        token = page.nextPageToken;
        if (!token || page.isLast || !page.issues.length) break;
      }
      return out;
    }
    for (let startAt = 0; out.length < limit; ) {
      const query: Query = { jql, startAt, maxResults: Math.min(100, limit - out.length), fields: opts.fields?.join(',') };
      const page = await this.http.get<{ issues: JiraIssue[]; total: number }>('/rest/api/2/search', query);
      out.push(...page.issues);
      startAt += page.issues.length;
      if (!page.issues.length || startAt >= page.total) break;
    }
    return out;
  }

  async createIssue(issue: NewIssue): Promise<{ id: string; key: string }> {
    const fields: Record<string, unknown> = {
      project: { key: issue.project },
      issuetype: { name: issue.issueType },
      summary: issue.summary,
      ...(issue.description !== undefined ? { description: markdownToJiraWiki(issue.description) } : {}),
      ...(issue.labels ? { labels: issue.labels } : {}),
      ...(issue.parentKey ? { parent: { key: issue.parentKey } } : {}),
      ...issue.fields,
    };
    if (this.flavor === 'cloud') {
      // Cloud: epics are parents ("Epic Link" was removed in 2025); Epic Name is optional.
      if (issue.epicKey) fields.parent = { key: issue.epicKey };
    } else {
      if (issue.issueType.toLowerCase() === 'epic') fields[await this.fieldId('Epic Name')] = issue.summary;
      if (issue.epicKey) fields[await this.fieldId('Epic Link')] = issue.epicKey;
    }
    return this.http.post('/rest/api/2/issue', { fields });
  }

  /** Put an existing issue under an epic. */
  async setEpic(key: string, epicKey: string) {
    const fields = this.flavor === 'cloud' ? { parent: { key: epicKey } } : { [await this.fieldId('Epic Link')]: epicKey };
    await this.updateIssue(key, { fields });
  }

  /** The epic an issue belongs to, if any. */
  async epicOf(key: string): Promise<string | undefined> {
    if (this.flavor === 'cloud') {
      const issue = await this.getIssue(key, 'parent');
      const parent = issue?.fields.parent as { key: string; fields?: { issuetype?: { name: string; hierarchyLevel?: number } } } | undefined;
      const type = parent?.fields?.issuetype;
      return parent && (type?.name.toLowerCase() === 'epic' || type?.hierarchyLevel === 1) ? parent.key : undefined;
    }
    const field = await this.fieldId('Epic Link').catch(() => undefined);
    if (!field) return undefined;
    return ((await this.getIssue(key, field))?.fields[field] as string | null) ?? undefined;
  }

  /** Update fields. `description` (if given) is markdown. */
  async updateIssue(key: string, changes: { summary?: string; description?: string; labels?: string[]; fields?: Record<string, unknown> }) {
    const fields: Record<string, unknown> = { ...changes.fields };
    if (changes.summary !== undefined) fields.summary = changes.summary;
    if (changes.description !== undefined) fields.description = markdownToJiraWiki(changes.description);
    if (changes.labels !== undefined) fields.labels = changes.labels;
    await this.http.put(`/rest/api/2/issue/${encodeURIComponent(key)}`, { fields });
  }

  async deleteIssue(key: string, deleteSubtasks = true) {
    await this.http.request('DELETE', `/rest/api/2/issue/${encodeURIComponent(key)}`, { query: { deleteSubtasks }, tolerate: [404] });
  }

  transitions(key: string) {
    return this.http
      .get<{ transitions: { id: string; name: string; to: { name: string } }[] }>(`/rest/api/2/issue/${encodeURIComponent(key)}/transitions`)
      .then((r) => r.transitions);
  }

  /**
   * Move an issue to a status (matched by target status name, then by transition name; case-insensitive).
   * No-op if it is already there. Returns false when no transition leads there from the current status.
   */
  async transitionTo(key: string, status: string): Promise<boolean> {
    const issue = await this.getIssue(key, 'status');
    if (!issue) throw new Error(`Issue ${key} not found`);
    const want = status.toLowerCase();
    if (issue.fields.status?.name.toLowerCase() === want) return true;
    const all = await this.transitions(key);
    const t = all.find((x) => x.to.name.toLowerCase() === want) ?? all.find((x) => x.name.toLowerCase() === want);
    if (!t) return false;
    await this.http.post(`/rest/api/2/issue/${encodeURIComponent(key)}/transitions`, { transition: { id: t.id } });
    return true;
  }

  /** Add a comment; body is markdown. */
  addComment(key: string, markdown: string) {
    return this.http.post<{ id: string }>(`/rest/api/2/issue/${encodeURIComponent(key)}/comment`, { body: markdownToJiraWiki(markdown) });
  }

  comments(key: string) {
    return this.http
      .get<{ comments: { id: string; body: string; author: { name: string }; created: string }[] }>(`/rest/api/2/issue/${encodeURIComponent(key)}/comment`)
      .then((r) => r.comments);
  }

  /**
   * linkIssues('Blocks', 'A-1', 'A-2') => "A-1 blocks A-2".
   * Counter-intuitively, the REST body's `inwardIssue` is the subject of the *outward* verb (verified on DC 10.3:
   * posting outwardIssue=A, inwardIssue=B yields "B blocks A").
   */
  async linkIssues(type: string, subjectKey: string, objectKey: string) {
    await this.http.post('/rest/api/2/issueLink', { type: { name: type }, inwardIssue: { key: subjectKey }, outwardIssue: { key: objectKey } });
  }

  /** Remote ("web") link on an issue, idempotent by globalId (e.g. a Confluence page or a PR). */
  async addRemoteLink(key: string, url: string, title: string, globalId = url) {
    await this.http.post(`/rest/api/2/issue/${encodeURIComponent(key)}/remotelink`, { globalId, object: { url, title } });
  }

  /** Issues in an epic (stories, tasks, bugs): Agile API on DC, `parent = EPIC` on Cloud (Agile endpoint deprecated). */
  async epicIssues(epicKey: string): Promise<JiraIssue[]> {
    if (this.flavor === 'cloud') return this.search(`parent = ${epicKey} ORDER BY created ASC`);
    const out: JiraIssue[] = [];
    for (let startAt = 0; ; ) {
      const page = await this.http.get<{ issues: JiraIssue[]; total: number }>(`/rest/agile/1.0/epic/${encodeURIComponent(epicKey)}/issue`, {
        startAt,
        maxResults: 100,
      });
      out.push(...page.issues);
      startAt += page.issues.length;
      if (!page.issues.length || startAt >= page.total) return out;
    }
  }

  /** Resolve a field id by display name (custom field ids differ per instance). */
  async fieldId(name: string): Promise<string> {
    this.fieldsCache ??= this.http.get<Field[]>('/rest/api/2/field');
    const f = (await this.fieldsCache).find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!f) throw new Error(`Jira field '${name}' not found on ${this.baseUrl}`);
    return f.id;
  }
}
