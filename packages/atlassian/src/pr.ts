/**
 * Pull requests: open (or update) the PR for the current branch with a body that ties it to Jira and the
 * verification, link it from the Jira issue, and publish code reviews to it.
 *
 * Not in the reference (it stops before PR creation; its review workflow only comments on an existing GitHub PR).
 * Outward-facing: callers (the `pr` skill) confirm with the user first; nothing here pushes commits.
 */
import type { ConfluenceClient } from './confluence.ts';
import type { JiraClient } from './jira.ts';
import type { StateFile } from './state.ts';
import { headSha, keyFrom, pushState, reviewScope } from './git.ts';
import type { GitHost, PullRequest } from './hosts/types.ts';
import { counts, isBlocking, readReview, renderJiraComment, renderPrComment, REVIEW_MARKER, type Verdict } from './review.ts';

const PR_MARKER = '<!-- sdlc-pr -->';

export type PrResult = { pr?: PullRequest; action: 'created' | 'updated' | 'unchanged' | 'would-create' | 'would-update'; key?: string; title: string; body: string };

export async function openPr(opts: {
  root: string;
  host: GitHost;
  jira?: JiraClient;
  confluence?: ConfluenceClient;
  state: StateFile;
  base?: string;
  title?: string;
  key?: string;
  draft?: boolean;
  dryRun?: boolean;
  /** Jira status to move the issue to when the PR is opened (e.g. "In Review"); off by default. */
  reviewStatus?: string;
}): Promise<PrResult> {
  const { root, host, jira, state, dryRun = false } = opts;
  const scope = reviewScope(root, opts.base);
  if (scope.branch === scope.base || scope.branch === 'HEAD') throw new Error(`On ${scope.branch}: create a feature branch (with the Jira key in its name) first.`);
  if (!scope.commits.length) throw new Error(`No commits on ${scope.branch} since ${scope.baseRef}.`);
  const push = pushState(root);
  if (!dryRun && push.ahead !== 0) {
    throw new Error(push.upstream ? `${push.ahead} commit(s) not pushed: git push` : `Branch not pushed: git push -u origin ${scope.branch}`);
  }

  const key = opts.key ?? scope.key ?? keyFrom(scope.commits.join(' '));
  const issue = key && jira ? await jira.getIssue(key, 'summary') : undefined;
  const title = opts.title ?? (key ? `${key}: ${issue?.fields.summary ?? scope.commits.at(-1)!.replace(/^\S+\s+/, '')}` : scope.commits.at(-1)!.replace(/^\S+\s+/, ''));
  const body = await prBody({ key, issueUrl: key && jira ? jira.browseUrl(key) : undefined, summary: issue?.fields.summary, commits: scope.commits, verificationUrl: await verificationUrl(opts, key) });

  const existing = await host.findOpenPr(scope.branch, scope.base);
  if (existing) {
    const same = existing.title === title && (await host.prBody(existing)).trim() === body.trim();
    if (same) return { pr: existing, action: 'unchanged', key, title, body };
    if (dryRun) return { pr: existing, action: 'would-update', key, title, body };
    await host.updatePr(existing, { title, body });
    return { pr: { ...existing, title }, action: 'updated', key, title, body };
  }
  if (dryRun) return { action: 'would-create', key, title, body };

  const pr = await host.createPr({ source: scope.branch, target: scope.base, title, body, draft: opts.draft });
  if (key && jira) {
    await jira.addRemoteLink(key, pr.url, `PR #${pr.id}: ${title}`);
    await jira.addComment(key, `Pull request opened: [${host.repoId} #${pr.id}](${pr.url})${opts.draft ? ' (draft)' : ''}`);
    if (opts.reviewStatus) await jira.transitionTo(key, opts.reviewStatus);
  }
  state.data.prs ??= {};
  state.data.prs[scope.branch] = { id: pr.id, url: pr.url, host: host.kind, repo: host.repoId, key };
  state.save();
  return { pr, action: 'created', key, title, body };
}

async function prBody(p: { key?: string; issueUrl?: string; summary?: string; commits: string[]; verificationUrl?: string }): Promise<string> {
  return [
    ...(p.key ? [`**Jira:** [${p.key}](${p.issueUrl ?? '#'})${p.summary ? ` ${p.summary}` : ''}`, ''] : []),
    ...(p.verificationUrl ? [`**Verification:** [report](${p.verificationUrl})`, ''] : []),
    '## Changes',
    '',
    ...p.commits.slice().reverse().map((c) => `- ${c}`),
    '',
    '_Code review results are posted as a comment (sdlc-atl)._',
    '',
    PR_MARKER,
  ].join('\n');
}

/** Link to the Confluence verification page recorded for this key by `sync`, if any. */
async function verificationUrl(opts: { confluence?: ConfluenceClient; state: StateFile }, key?: string) {
  if (!key || !opts.confluence) return undefined;
  const item = Object.values(opts.state.data.items).find((i) => i.issueKey === key);
  const pageId = item?.verificationPageId ?? opts.state.data.tickets?.[key]?.verificationPageId;
  if (!pageId) return undefined;
  const page = await opts.confluence.getPage(pageId);
  return page && opts.confluence.pageUrl(page);
}

// ---------------------------------------------------------------------------------------------

export type ReviewPublishResult = {
  pr: PullRequest;
  verdict: Verdict;
  counts: Record<string, number>;
  blocking: number;
  comment: 'created' | 'updated' | 'unchanged';
  annotations: boolean;
  jiraCommented: boolean;
};

/** Publish a review file to the branch's open PR (one comment, updated in place), host annotations, and Jira. */
export async function publishReview(opts: { root: string; host: GitHost; jira?: JiraClient; file: string; base?: string }): Promise<ReviewPublishResult> {
  const { root, host, jira } = opts;
  const review = readReview(opts.file);
  const scope = reviewScope(root, opts.base ?? review.base);
  const pr = await host.findOpenPr(scope.branch, scope.base);
  if (!pr) throw new Error(`No open PR for ${scope.branch} -> ${scope.base}; open one first (sdlc-atl pr).`);
  const head = headSha(root);
  if (review.head && !head.startsWith(review.head) && !review.head.startsWith(head.slice(0, review.head.length))) {
    throw new Error(`Review is for commit ${review.head} but the branch is at ${head.slice(0, 10)}: review again (or update "head" if nothing relevant changed).`);
  }
  const comment = await host.upsertComment(pr, REVIEW_MARKER, renderPrComment(review, host, head));
  const blocking = review.findings.filter(isBlocking).length;
  const annotations = await host.publishAnnotations(pr, head, {
    key: 'sdlc-review',
    title: 'Code review (sdlc)',
    passed: blocking === 0,
    details: `${review.verdict}: ${review.findings.length} finding(s), ${blocking} blocking`,
    findings: review.findings,
  });
  const key = scope.key;
  let jiraCommented = false;
  if (jira && key && comment !== 'unchanged') {
    await jira.addComment(key, renderJiraComment(review, pr.url));
    jiraCommented = true;
  }
  return { pr, verdict: review.verdict, counts: counts(review.findings), blocking, comment, annotations, jiraCommented };
}
