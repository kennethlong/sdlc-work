import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keyFrom, keysIn, reviewScope } from '../src/git.ts';
import { resolveKey } from '../src/pr.ts';
import type { JiraClient } from '../src/jira.ts';
import { GitHubHost, parseRemote } from '../src/hosts/index.ts';
import { categoryCounts, readReview, renderJiraComment, renderPrComment, REVIEW_MARKER, statsLine } from '../src/review.ts';

const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'sdlc-review-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
  vi.unstubAllGlobals();
});

describe('parseRemote', () => {
  it.each([
    ['https://github.com/acme/api.git', { kind: 'github', owner: 'acme', repo: 'api' }],
    ['git@github.com:acme/api.git', { kind: 'github', owner: 'acme', repo: 'api' }],
    ['https://bitbucket.acme.com/scm/plat/api.git', { kind: 'bitbucket-dc', project: 'PLAT', repo: 'api' }],
    ['https://acme.com/bitbucket/scm/plat/api.git', { kind: 'bitbucket-dc', project: 'PLAT', repo: 'api' }],
    ['ssh://git@bitbucket.acme.com:7999/plat/api.git', { kind: 'bitbucket-dc', project: 'PLAT', repo: 'api' }],
    ['https://ghe.acme.com/team/api', { kind: 'github', owner: 'team', repo: 'api' }],
  ])('%s', (url, expected) => expect(parseRemote(url, { githubHost: 'ghe.acme.com' })).toMatchObject(expected));

  it('returns undefined for unknown hosts', () => expect(parseRemote('https://gitlab.com/a/b.git')).toBeUndefined());
});

describe('keyFrom', () => {
  it.each([
    ['feature/SDLC-12-export', 'SDLC-12'],
    ['sdlc-7-fix', 'SDLC-7'],
    ['bugfix/PROJ-101', 'PROJ-101'],
    ['main', undefined],
  ])('%s', (b, k) => expect(keyFrom(b)).toBe(k));
});

describe('reviewScope', () => {
  it('covers everything committed on the branch (base...HEAD), and reports uncommitted work separately', () => {
    const repo = tmp();
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 't@e.x');
    git(repo, 'config', 'user.name', 't');
    writeFileSync(join(repo, 'a.ts'), 'a');
    git(repo, 'add', '.');
    git(repo, 'commit', '-qm', 'base');
    git(repo, 'checkout', '-qb', 'feature/SDLC-12-export');
    writeFileSync(join(repo, 'b.ts'), 'b');
    git(repo, 'add', '.');
    git(repo, 'commit', '-qm', 'SDLC-12 add b');
    writeFileSync(join(repo, 'c.ts'), 'uncommitted');

    const s = reviewScope(repo);
    expect(s).toMatchObject({ base: 'main', branch: 'feature/SDLC-12-export', key: 'SDLC-12' });
    expect(s.files).toEqual([{ status: 'A', path: 'b.ts' }]); // committed work is in scope (`git diff HEAD` would miss it)
    expect(s.uncommitted).toEqual(['?? c.ts']);
    expect(s.commits).toHaveLength(1);
  });
});

describe('review files', () => {
  const write = (body: string) => {
    const f = join(tmp(), 'r.md');
    writeFileSync(f, body);
    return f;
  };

  it('parses findings, orders by severity, infers the verdict', () => {
    const r = readReview(
      write(
        [
          '---',
          'base: main',
          'findings:',
          '  - { severity: low, file: src/a.ts, line: 3, title: Naming }',
          '  - { severity: HIGH, file: "src\\\\b.ts", line: 42, title: "Unescaped | cell", detail: d, suggestion: s }',
          '---',
          '# Code review: x',
          '',
          'Looks mostly fine.',
        ].join('\n'),
      ),
    );
    expect(r.verdict).toBe('changes_requested');
    expect(r.findings.map((f) => [f.severity, f.file])).toEqual([
      ['high', 'src/b.ts'],
      ['low', 'src/a.ts'],
    ]);
    const host = new GitHubHost({ owner: 'o', repo: 'r', token: 't' });
    const md = renderPrComment(r, host, 'abc1234567890');
    expect(md).toContain('## ❌ Code review: changes requested');
    expect(md).toContain('[src/b.ts:42](https://github.com/o/r/blob/abc1234567890/src/b.ts#L42)');
    expect(md).toContain('Unescaped \\| cell');
    expect(md).toContain('_Suggestion:_ s');
    expect(md).toContain('Looks mostly fine.');
    expect(renderJiraComment(r, 'https://pr')).toContain('- high: Unescaped | cell (`src/b.ts:42`)');
  });

  it('rejects malformed findings', () => {
    expect(() => readReview(write('---\nfindings:\n  - { severity: urgent, file: a, title: t }\n---\n'))).toThrow(/severity "urgent"/);
    expect(() => readReview(write('# no front matter'))).toThrow(/front matter/);
  });

  it('an empty review approves', () => expect(readReview(write('---\nfindings: []\n---\nAll good.')).verdict).toBe('approved'));

  it('normalises categories (quality included) and renders them with change stats', () => {
    const r = readReview(
      write(
        [
          '---',
          'findings:',
          '  - { severity: medium, category: Code Quality, file: src/a.ts, line: 3, title: Duplicated parser }',
          '  - { severity: high, category: security, file: src/b.ts, line: 9, title: Injection }',
          '  - { severity: low, category: quality, file: src/c.ts, title: Long function }',
          '  - { severity: low, file: src/d.ts, title: No category }',
          'stats: { files_added: 1, files_modified: 2, files_deleted: 0, lines_added: 120, lines_deleted: 14 }',
          '---',
        ].join('\n'),
      ),
    );
    expect(r.findings.map((f) => f.category)).toEqual(['security', 'quality', 'quality', undefined]);
    expect(r.stats).toEqual({ filesAdded: 1, filesModified: 2, filesDeleted: 0, linesAdded: 120, linesDeleted: 14 });
    expect(categoryCounts(r.findings)).toEqual([['security', 1], ['quality', 2], ['uncategorised', 1]]);
    const md = renderPrComment(r, new GitHubHost({ owner: 'o', repo: 'r', token: 't' }), 'abc1234567890');
    expect(md).toContain('**Changes:** 3 files (1 added, 2 modified) · +120 −14 lines');
    expect(md).toContain('**By category:** security 1 · quality 2 · uncategorised 1');
    expect(md).toContain('| 1 | high | security | [src/b.ts:9]');
    const jira = renderJiraComment(r, 'https://pr');
    expect(jira).toContain('By category: security 1 · quality 2 · uncategorised 1');
    expect(jira).toContain('Changes: 3 files (1 added, 2 modified) · +120 −14 lines');
  });

  it('stays compatible with review files that have no stats or categories', () => {
    const r = readReview(write('---\nbase: main\nfindings:\n  - { severity: low, file: a.ts, title: t }\n---\n'));
    expect(r.stats).toBeUndefined();
    const md = renderPrComment(r, new GitHubHost({ owner: 'o', repo: 'r', token: 't' }), 'abc1234567890');
    expect(md).not.toContain('**Changes:**');
    expect(md).toContain('**By category:** uncategorised 1');
    expect(statsLine(undefined)).toBeUndefined();
    expect(renderJiraComment(readReview(write('---\nfindings: []\n---\n')), 'https://pr')).toBe('Code review ✅ **approved** (no findings) on [the pull request](https://pr).');
  });
});

describe('GitHub host (contract)', () => {
  it('finds, creates and upserts one marked comment', async () => {
    const calls: { method: string; path: string; body?: any }[] = [];
    let comments: { id: number; body: string }[] = [];
    vi.stubGlobal('fetch', async (input: URL | string, init: RequestInit = {}) => {
      const url = new URL(String(input));
      const method = init.method ?? 'GET';
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, path: url.pathname + url.search, body });
      const h = new Headers(init.headers);
      expect(h.get('accept')).toBe('application/vnd.github+json');
      expect(h.get('authorization')).toBe('Bearer tok');
      const json = (j: unknown, status = 200) => new Response(JSON.stringify(j), { status });
      const pull = { number: 7, html_url: 'https://github.com/o/r/pull/7', title: 'T', state: 'open', head: { ref: 'feat' }, base: { ref: 'main' }, body: 'b' };
      if (url.pathname === '/repos/o/r/pulls' && method === 'GET') return json(url.searchParams.get('head') === 'o:feat' ? [] : []);
      if (url.pathname === '/repos/o/r/pulls' && method === 'POST') return json(pull, 201);
      if (url.pathname === '/repos/o/r/issues/7/comments' && method === 'GET') return json(comments);
      if (url.pathname === '/repos/o/r/issues/7/comments' && method === 'POST') return (comments.push({ id: 1, body: body.body }), json({ id: 1 }, 201));
      if (url.pathname === '/repos/o/r/issues/comments/1' && method === 'PATCH') return ((comments[0]!.body = body.body), json({ id: 1 }));
      return json({ message: 'no route' }, 404);
    });
    const gh = new GitHubHost({ owner: 'o', repo: 'r', token: 'tok' });
    expect(await gh.findOpenPr('feat', 'main')).toBeUndefined();
    expect(calls[0]!.path).toBe('/repos/o/r/pulls?state=open&head=o%3Afeat&base=main');
    const pr = await gh.createPr({ source: 'feat', target: 'main', title: 'T', body: 'b' });
    expect(pr).toMatchObject({ id: '7', state: 'open', source: 'feat', target: 'main' });
    expect(await gh.upsertComment(pr, REVIEW_MARKER, 'one')).toBe('created');
    expect(await gh.upsertComment(pr, REVIEW_MARKER, 'one')).toBe('unchanged');
    expect(await gh.upsertComment(pr, REVIEW_MARKER, 'two')).toBe('updated');
    expect(comments).toHaveLength(1);
    expect(await gh.publishAnnotations(pr, 'sha', { key: 'k', title: 't', passed: true, details: '', findings: [] })).toBe(false);
  });
});

describe('review file front matter', () => {
  it.each(['1234567', '12e4567', '0123456'])('keeps a numeric-looking short SHA (%s) as text', (sha) => {
    const f = join(tmp(), 'r.md');
    writeFileSync(f, `---\nbase: main\nhead: ${sha}\nverdict: approved\nfindings: []\n---\nok\n`);
    expect(readReview(f).head).toBe(sha);
  });
});

describe('Jira key resolution', () => {
  it('lists every candidate in order', () => {
    expect(keysIn('gsd/phase-03-x: fix utf-8 for SDLC-12, see sdlc-12 and ABC-4')).toEqual(['PHASE-03', 'UTF-8', 'SDLC-12', 'ABC-4']);
  });

  it('with configured projects, skips look-alikes', async () => {
    expect(await resolveKey({ texts: ['gsd/phase-03-export', 'a1b2c3 fix utf-8 in SDLC-7 export'], projects: ['sdlc'] })).toBe('SDLC-7');
    expect(await resolveKey({ texts: ['fix utf-8'], projects: ['SDLC'] })).toBeUndefined();
  });

  it('without projects, keeps the first candidate that exists in Jira', async () => {
    const jira = { getIssue: async (k: string) => (k === 'SDLC-7' ? { key: k } : undefined) } as unknown as JiraClient;
    expect(await resolveKey({ texts: ['phase-03', 'fix UTF-8, then SDLC-7'], jira })).toBe('SDLC-7');
  });

  it('an explicit key always wins', async () => {
    expect(await resolveKey({ explicit: 'abc-1', texts: ['SDLC-7'], projects: ['SDLC'] })).toBe('ABC-1');
  });
});
