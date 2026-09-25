import { HttpClient } from '../http.ts';
import type { Finding, GitHost, NewPullRequest, PullRequest } from './types.ts';

type GhPull = { number: number; html_url: string; title: string; state: 'open' | 'closed'; merged_at?: string | null; draft?: boolean; body?: string | null; head: { ref: string }; base: { ref: string } };
type GhComment = { id: number; body: string };

/**
 * GitHub (github.com or Enterprise Server) via REST v3 with a token (GITHUB_TOKEN, or the `gh` CLI's token).
 * Findings are published as one summary comment; line-level annotations need a GitHub App (checks API), so
 * `publishAnnotations` reports "unsupported".
 */
export class GitHubHost implements GitHost {
  readonly kind = 'github' as const;
  readonly repoId: string;
  private readonly http: HttpClient;
  private readonly web: string;

  constructor(opts: { owner: string; repo: string; token: string; apiUrl?: string; webUrl?: string }) {
    this.repoId = `${opts.owner}/${opts.repo}`;
    this.web = (opts.webUrl ?? 'https://github.com').replace(/\/+$/, '');
    this.http = new HttpClient(opts.apiUrl ?? 'https://api.github.com', { type: 'bearer', token: opts.token }, {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    });
  }

  private get repoPath() {
    return `/repos/${this.repoId}`;
  }

  private toPr(p: GhPull): PullRequest {
    return {
      id: String(p.number),
      url: p.html_url,
      title: p.title,
      state: p.state === 'open' ? 'open' : p.merged_at ? 'merged' : 'declined',
      source: p.head.ref,
      target: p.base.ref,
      draft: p.draft,
    };
  }

  async findOpenPr(source: string, target?: string): Promise<PullRequest | undefined> {
    const owner = this.repoId.split('/')[0];
    const pulls = await this.http.get<GhPull[]>(`${this.repoPath}/pulls`, { state: 'open', head: `${owner}:${source}`, ...(target ? { base: target } : {}) });
    return pulls[0] && this.toPr(pulls[0]);
  }

  async getPr(id: string): Promise<PullRequest | undefined> {
    const p = await this.http.get<GhPull>(`${this.repoPath}/pulls/${id}`, undefined, [404]);
    return p && this.toPr(p);
  }

  async createPr(pr: NewPullRequest): Promise<PullRequest> {
    return this.toPr(await this.http.post<GhPull>(`${this.repoPath}/pulls`, { title: pr.title, head: pr.source, base: pr.target, body: pr.body, draft: pr.draft ?? false }));
  }

  async updatePr(pr: PullRequest, changes: { title?: string; body?: string }) {
    await this.http.request('PATCH', `${this.repoPath}/pulls/${pr.id}`, { body: changes });
  }

  async prBody(pr: PullRequest): Promise<string> {
    return (await this.http.get<GhPull>(`${this.repoPath}/pulls/${pr.id}`)).body ?? '';
  }

  async upsertComment(pr: PullRequest, marker: string, markdown: string) {
    const body = `${marker}\n${markdown}`;
    for (let page = 1; ; page++) {
      const comments = await this.http.get<GhComment[]>(`${this.repoPath}/issues/${pr.id}/comments`, { per_page: 100, page });
      const mine = comments.find((c) => c.body.includes(marker));
      if (mine) {
        if (mine.body === body) return 'unchanged' as const;
        await this.http.request('PATCH', `${this.repoPath}/issues/comments/${mine.id}`, { body: { body } });
        return 'updated' as const;
      }
      if (comments.length < 100) break;
    }
    await this.http.post(`${this.repoPath}/issues/${pr.id}/comments`, { body });
    return 'created' as const;
  }

  async publishAnnotations(_pr: PullRequest, _commit: string, _report: { key: string; title: string; passed: boolean; details: string; findings: Finding[] }) {
    return false;
  }

  fileUrl(path: string, line: number | undefined, ref: string) {
    return `${this.web}/${this.repoId}/blob/${ref}/${path.split('/').map(encodeURIComponent).join('/')}${line ? `#L${line}` : ''}`;
  }
}
