import { execFileSync } from 'node:child_process';
import { envLookup, type EnvOptions } from '../config.ts';
import { remoteUrl } from '../git.ts';
import { BitbucketDcHost } from './bitbucket.ts';
import { GitHubHost } from './github.ts';
import type { GitHost } from './types.ts';

export { BitbucketDcHost } from './bitbucket.ts';
export { GitHubHost } from './github.ts';
export type { Finding, GitHost, HostKind, NewPullRequest, PullRequest } from './types.ts';

export type RemoteInfo =
  | { kind: 'github'; host: string; owner: string; repo: string }
  | { kind: 'bitbucket-dc'; host: string; project: string; repo: string };

/**
 * Recognise the hosting provider from a git remote URL:
 *   GitHub:          https://github.com/o/r(.git), git@github.com:o/r.git, or GITHUB_HOST (Enterprise)
 *   Bitbucket DC:    https://host[/ctx]/scm/PROJ/repo.git, ssh://git@host:7999/proj/repo.git, or BITBUCKET_BASE_URL's host
 */
export function parseRemote(url: string, hints: { githubHost?: string; bitbucketHost?: string } = {}): RemoteInfo | undefined {
  const u = url.trim();
  const scp = u.match(/^[^@\s]+@([^:\s]+):(.+?)(?:\.git)?\/?$/); // git@host:owner/repo.git
  let host: string;
  let path: string;
  if (scp && !u.includes('://')) {
    host = scp[1]!;
    path = scp[2]!;
  } else {
    try {
      const parsed = new URL(u);
      host = parsed.hostname;
      path = parsed.pathname.replace(/^\/+/, '').replace(/\.git\/?$/, '').replace(/\/+$/, '');
    } catch {
      return undefined;
    }
  }
  const parts = path.split('/').filter(Boolean);
  const scmAt = parts.findIndex((p) => p === 'scm');
  const isBitbucket = scmAt >= 0 || /:7999\//.test(u) || (hints.bitbucketHost && host === hints.bitbucketHost);
  if (isBitbucket) {
    const [project, repo] = scmAt >= 0 ? parts.slice(scmAt + 1) : parts.slice(-2);
    if (project && repo) return { kind: 'bitbucket-dc', host, project: project.toUpperCase(), repo };
  }
  if (host === 'github.com' || host === hints.githubHost) {
    const [owner, repo] = parts.slice(-2);
    if (owner && repo) return { kind: 'github', host, owner, repo };
  }
  return undefined;
}

/**
 * The host for the repo at `cwd`, from its `origin` remote. Credentials: BITBUCKET_BASE_URL + BITBUCKET_TOKEN; GitHub:
 * GITHUB_TOKEN (or GH_TOKEN), else the `gh` CLI's token; Enterprise: GITHUB_HOST (+ GITHUB_API_URL if non-standard).
 */
export function resolveHost(cwd: string, opts: EnvOptions & { remote?: string } = {}): GitHost {
  const get = envLookup({ ...opts, cwd: opts.cwd ?? cwd });
  const url = remoteUrl(cwd, opts.remote);
  if (!url) throw new Error(`No '${opts.remote ?? 'origin'}' remote in ${cwd}`);
  const bbBase = get('BITBUCKET_BASE_URL');
  const info = parseRemote(url, { githubHost: get('GITHUB_HOST') || undefined, bitbucketHost: bbBase ? new URL(bbBase).hostname : undefined });
  if (!info) throw new Error(`Unrecognised git host for remote ${url} (supported: GitHub, Bitbucket Data Center)`);

  if (info.kind === 'bitbucket-dc') {
    const token = get('BITBUCKET_TOKEN');
    if (!bbBase || !token) throw new Error('Bitbucket needs BITBUCKET_BASE_URL and BITBUCKET_TOKEN (an HTTP access token), e.g. in ~/.sdlc/atlassian.env');
    return new BitbucketDcHost({ baseUrl: bbBase, project: info.project, repo: info.repo, token });
  }
  const token = get('GITHUB_TOKEN') || get('GH_TOKEN') || ghCliToken(info.host);
  if (!token) throw new Error('GitHub needs GITHUB_TOKEN (or a logged-in `gh` CLI)');
  const enterprise = info.host !== 'github.com';
  return new GitHubHost({
    owner: info.owner,
    repo: info.repo,
    token,
    webUrl: `https://${info.host}`,
    apiUrl: get('GITHUB_API_URL') || (enterprise ? `https://${info.host}/api/v3` : 'https://api.github.com'),
  });
}

function ghCliToken(host: string): string | undefined {
  try {
    return execFileSync('gh', ['auth', 'token', '--hostname', host], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined;
  } catch {
    return undefined;
  }
}
