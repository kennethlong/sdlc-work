import { HttpClient } from '../http.ts';
import type { Finding, GitHost, NewPullRequest, PullRequest } from './types.ts';

type BbRef = { id: string; displayId: string };
type BbPr = { id: number; version: number; title: string; description?: string; state: 'OPEN' | 'MERGED' | 'DECLINED'; draft?: boolean; fromRef: BbRef; toRef: BbRef; links: { self: { href: string }[] } };
type BbComment = { id: number; version: number; text: string };
type BbActivity = { action: string; comment?: BbComment };

/**
 * Bitbucket escapes raw HTML in markdown, so an HTML-comment marker (`<!-- sdlc-review -->`) would show as text.
 * Store it as a CommonMark link reference definition instead, which renders as nothing: `[//]: # (sdlc-review)`.
 */
const toBb = (md: string) => md.replace(/<!--\s*([\w.-]+)\s*-->/g, '[//]: # ($1)');
const fromBb = (md: string) => md.replace(/^\[\/\/\]: # \(([\w.-]+)\)$/gm, '<!-- $1 -->');

const SEVERITY: Record<Finding['severity'], 'HIGH' | 'MEDIUM' | 'LOW'> = { critical: 'HIGH', high: 'HIGH', medium: 'MEDIUM', low: 'LOW' };

/**
 * Bitbucket Data Center via REST 1.0 with an HTTP access token. Findings additionally become a Code Insights report
 * with line annotations on the PR's head commit, shown inline in the PR diff.
 */
export class BitbucketDcHost implements GitHost {
  readonly kind = 'bitbucket-dc' as const;
  readonly repoId: string;
  private readonly http: HttpClient;
  private readonly project: string;
  private readonly repo: string;

  constructor(opts: { baseUrl: string; project: string; repo: string; token: string }) {
    this.project = opts.project.toUpperCase();
    this.repo = opts.repo;
    this.repoId = `${this.project}/${this.repo}`;
    this.http = new HttpClient(opts.baseUrl, { type: 'bearer', token: opts.token });
  }

  get baseUrl() {
    return this.http.baseUrl;
  }

  private get repoPath() {
    return `/rest/api/1.0/projects/${this.project}/repos/${encodeURIComponent(this.repo)}`;
  }

  private ref(branch: string) {
    return { id: `refs/heads/${branch}`, repository: { slug: this.repo, project: { key: this.project } } };
  }

  private toPr(p: BbPr): PullRequest {
    return {
      id: String(p.id),
      url: p.links.self[0]!.href,
      title: p.title,
      state: p.state === 'OPEN' ? 'open' : p.state === 'MERGED' ? 'merged' : 'declined',
      source: p.fromRef.displayId,
      target: p.toRef.displayId,
      draft: p.draft,
    };
  }

  private async raw(id: string) {
    return this.http.get<BbPr>(`${this.repoPath}/pull-requests/${id}`);
  }

  async findOpenPr(source: string, target?: string): Promise<PullRequest | undefined> {
    const r = await this.http.get<{ values: BbPr[] }>(`${this.repoPath}/pull-requests`, { state: 'OPEN', direction: 'OUTGOING', at: `refs/heads/${source}`, limit: 50 });
    const hit = r.values.find((p) => !target || p.toRef.displayId === target);
    return hit && this.toPr(hit);
  }

  async getPr(id: string): Promise<PullRequest | undefined> {
    const p = await this.http.get<BbPr>(`${this.repoPath}/pull-requests/${id}`, undefined, [404]);
    return p && this.toPr(p);
  }

  async createPr(pr: NewPullRequest): Promise<PullRequest> {
    return this.toPr(
      await this.http.post<BbPr>(`${this.repoPath}/pull-requests`, {
        title: pr.title,
        description: toBb(pr.body),
        fromRef: this.ref(pr.source),
        toRef: this.ref(pr.target),
        ...(pr.draft ? { draft: true } : {}),
      }),
    );
  }

  async updatePr(pr: PullRequest, changes: { title?: string; body?: string }) {
    const current = await this.raw(pr.id); // PUT needs the current version (optimistic locking)
    await this.http.put(`${this.repoPath}/pull-requests/${pr.id}`, {
      version: current.version,
      title: changes.title ?? current.title,
      description: changes.body !== undefined ? toBb(changes.body) : (current.description ?? ''),
    });
  }

  async prBody(pr: PullRequest): Promise<string> {
    return fromBb((await this.raw(pr.id)).description ?? '');
  }

  async upsertComment(pr: PullRequest, marker: string, markdown: string) {
    const text = `${markdown}\n\n${toBb(marker)}`;
    for (let start = 0; ; ) {
      const page = await this.http.get<{ values: BbActivity[]; isLastPage: boolean; nextPageStart?: number }>(`${this.repoPath}/pull-requests/${pr.id}/activities`, { start, limit: 100 });
      const mine = page.values.find((a) => a.action === 'COMMENTED' && (a.comment?.text.includes(toBb(marker)) || a.comment?.text.includes(marker)))?.comment;
      if (mine) {
        if (mine.text === text) return 'unchanged' as const;
        await this.http.put(`${this.repoPath}/pull-requests/${pr.id}/comments/${mine.id}`, { text, version: mine.version });
        return 'updated' as const;
      }
      if (page.isLastPage || page.nextPageStart === undefined) break;
      start = page.nextPageStart;
    }
    await this.http.post(`${this.repoPath}/pull-requests/${pr.id}/comments`, { text });
    return 'created' as const;
  }

  /** Code Insights: one report per key on the head commit (replaced on re-publish) plus its line annotations. */
  async publishAnnotations(_pr: PullRequest, commit: string, report: { key: string; title: string; passed: boolean; details: string; findings: Finding[] }) {
    const base = `/rest/insights/1.0/projects/${this.project}/repos/${encodeURIComponent(this.repo)}/commits/${commit}/reports/${encodeURIComponent(report.key)}`;
    await this.http.put(base, {
      title: report.title,
      details: report.details.slice(0, 2000),
      result: report.passed ? 'PASS' : 'FAIL',
      reporter: 'sdlc-atl',
      data: (['critical', 'high', 'medium', 'low'] as const).map((s) => ({ title: s, type: 'NUMBER', value: report.findings.filter((f) => f.severity === s).length })),
    });
    await this.http.request('DELETE', `${base}/annotations`, { tolerate: [404] });
    const annotations = report.findings.slice(0, 1000).map((f, i) => ({
      externalId: `sdlc-${i + 1}`,
      path: f.file,
      line: f.line ?? 0, // 0 = file-level annotation
      message: [f.title, f.suggestion ? `Suggestion: ${f.suggestion}` : ''].filter(Boolean).join('. ').slice(0, 2000),
      severity: SEVERITY[f.severity],
      type: f.category === 'security' ? 'VULNERABILITY' : f.category === 'bug' || f.severity === 'critical' || f.severity === 'high' ? 'BUG' : 'CODE_SMELL',
    }));
    if (annotations.length) await this.http.post(`${base}/annotations`, { annotations });
    return true;
  }

  fileUrl(path: string, line: number | undefined, ref: string) {
    return `${this.http.baseUrl}/projects/${this.project}/repos/${this.repo}/browse/${path}?at=${encodeURIComponent(ref)}${line ? `#${line}` : ''}`;
  }
}
