/** Local git facts the review/PR flow needs. Read-only: nothing here pushes or changes the repo. */
import { execFileSync } from 'node:child_process';

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function tryGit(cwd: string, ...args: string[]): string | undefined {
  try {
    return git(cwd, ...args);
  } catch {
    return undefined;
  }
}

export const currentBranch = (cwd: string) => git(cwd, 'rev-parse', '--abbrev-ref', 'HEAD');
export const headSha = (cwd: string) => git(cwd, 'rev-parse', 'HEAD');
export const remoteUrl = (cwd: string, remote = 'origin') => tryGit(cwd, 'remote', 'get-url', remote);

/** The branch PRs target: explicit, else origin's default branch, else main/master (whichever exists). */
export function defaultBase(cwd: string, explicit?: string): string {
  if (explicit) return explicit;
  const originHead = tryGit(cwd, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD');
  if (originHead) return originHead.replace(/^origin\//, '');
  for (const b of ['main', 'master']) if (tryGit(cwd, 'rev-parse', '--verify', '--quiet', b) || tryGit(cwd, 'rev-parse', '--verify', '--quiet', `origin/${b}`)) return b;
  return 'main';
}

/** First Jira-style key in a branch name or text: "feature/SDLC-12-export" -> "SDLC-12". */
export function keyFrom(text: string): string | undefined {
  return text.match(/(?:^|[^A-Za-z0-9])([A-Za-z][A-Za-z0-9]+-\d+)(?=$|[^0-9])/)?.[1]?.toUpperCase();
}

export type ReviewScope = {
  base: string;
  /** Resolved base ref actually compared (prefers origin/<base> when it exists). */
  baseRef: string;
  mergeBase: string;
  head: string;
  branch: string;
  key?: string;
  /** Committed changes on the branch: `git diff <merge-base>...HEAD`. */
  files: { status: string; path: string }[];
  /** Uncommitted changes, reported separately so they are not silently reviewed or missed. */
  uncommitted: string[];
  stat: string;
  commits: string[];
};

/**
 * What a review covers: everything committed on the branch since it left the base (`base...HEAD`), not just the
 * working tree. (The reference's review used `git diff HEAD`, which misses committed work.)
 */
export function reviewScope(cwd: string, base?: string): ReviewScope {
  const b = defaultBase(cwd, base);
  const baseRef = tryGit(cwd, 'rev-parse', '--verify', '--quiet', `origin/${b}`) ? `origin/${b}` : b;
  const mergeBase = git(cwd, 'merge-base', baseRef, 'HEAD');
  const branch = currentBranch(cwd);
  const files = git(cwd, 'diff', '--name-status', `${mergeBase}...HEAD`)
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [status, ...rest] = l.split('\t');
      return { status: status!, path: rest.at(-1)! };
    });
  return {
    base: b,
    baseRef,
    mergeBase,
    head: headSha(cwd),
    branch,
    key: keyFrom(branch),
    files,
    uncommitted: git(cwd, 'status', '--porcelain').split('\n').filter(Boolean),
    stat: git(cwd, 'diff', '--stat', `${mergeBase}...HEAD`),
    commits: git(cwd, 'log', '--format=%h %s', `${mergeBase}..HEAD`).split('\n').filter(Boolean),
  };
}

/** Is the branch pushed and up to date with its upstream? */
export function pushState(cwd: string): { upstream?: string; ahead: number } {
  const upstream = tryGit(cwd, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}');
  if (!upstream) return { ahead: Number.POSITIVE_INFINITY };
  return { upstream, ahead: Number(git(cwd, 'rev-list', '--count', `${upstream}..HEAD`)) };
}
