/** Git hosting providers the PR/review flow supports. */
export type HostKind = 'github' | 'bitbucket-dc';

export type PullRequest = {
  id: string;
  url: string;
  title: string;
  state: 'open' | 'merged' | 'declined';
  source: string;
  target: string;
  draft?: boolean;
};

export type NewPullRequest = { source: string; target: string; title: string; body: string; draft?: boolean };

/** A code-review finding, as recorded in the review file and published to the host. */
export type Finding = {
  severity: 'critical' | 'high' | 'medium' | 'low';
  file: string;
  line?: number;
  title: string;
  detail?: string;
  suggestion?: string;
  category?: string;
};

export interface GitHost {
  readonly kind: HostKind;
  /** Human-readable repo id, e.g. "acme/api" or "SDLC/sandbox". */
  readonly repoId: string;
  findOpenPr(source: string, target?: string): Promise<PullRequest | undefined>;
  getPr(id: string): Promise<PullRequest | undefined>;
  createPr(pr: NewPullRequest): Promise<PullRequest>;
  updatePr(pr: PullRequest, changes: { title?: string; body?: string }): Promise<void>;
  /** Current PR description (to avoid rewriting an unchanged body). */
  prBody(pr: PullRequest): Promise<string>;
  /**
   * Create or update the one comment on the PR that contains `marker` (an HTML comment), so repeated publishes edit
   * in place instead of stacking comments.
   */
  upsertComment(pr: PullRequest, marker: string, markdown: string): Promise<'created' | 'updated' | 'unchanged'>;
  /** Line-level findings, where the host supports it (Bitbucket Code Insights). Returns false if unsupported. */
  publishAnnotations(pr: PullRequest, commit: string, report: { key: string; title: string; passed: boolean; details: string; findings: Finding[] }): Promise<boolean>;
  fileUrl(path: string, line: number | undefined, ref: string): string;
}
