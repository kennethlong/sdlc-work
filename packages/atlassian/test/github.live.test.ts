// Slice 8 on real GitHub: PR lifecycle against a throwaway private repo. Opt-in: set SDLC_GITHUB_TEST_REPO=owner/repo
// (the repo must exist; the test pushes and deletes its own branches). Jira steps run when Jira is configured.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, envLookup, GitHubHost, importTicket, JiraClient, loadConfig, openPr, PivEngine, publishReview, resolveHost, StateFile, syncProgress } from '../src/index.ts';
import { TEST_PROJECT } from './engines.ts';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const testRepo = process.env.SDLC_GITHUB_TEST_REPO;
const cfg = loadConfig({ cwd: repoRoot });

function ghToken(): string {
  const env = envLookup({ cwd: repoRoot });
  return env('GITHUB_TOKEN') || env('GH_TOKEN') || execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
}

describe.skipIf(!testRepo)('PR + review (live, GitHub)', () => {
  const run = `t${Date.now().toString(36)}`;
  // A persistent base: GitHub makes the first pushed branch the default and refuses to delete it.
  const base = 'main';
  let root: string;
  let branch = '';
  let key = '';
  let jira: JiraClient | undefined;
  let host: GitHubHost;
  let token = '';
  const git = (...a: string[]) =>
    execFileSync('git', ['-c', `http.extraHeader=Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`, ...a], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const commit = (file: string, msg: string) => {
    writeFileSync(join(root, file), `${msg}\n`);
    git('add', '.');
    git('commit', '-qm', msg);
  };

  beforeAll(async () => {
    token = ghToken();
    jira = cfg.jira ? connect({ cwd: repoRoot }).jira : undefined;
    key = jira ? (await jira.createIssue({ project: TEST_PROJECT, issueType: 'Story', summary: `${run} GitHub PR test` })).key : 'NOJIRA-1';
    branch = `feature/${key}-gh-test`;
    root = mkdtempSync(join(tmpdir(), 'sdlc-gh-'));
    git('init', '-q', '-b', base);
    git('config', 'user.email', 't@e.x');
    git('config', 'user.name', 't');
    git('remote', 'add', 'origin', `https://github.com/${testRepo}.git`);
    if (git('ls-remote', '--heads', 'origin', base).trim()) {
      git('fetch', '-q', 'origin', base);
      git('checkout', '-q', '-B', base, `origin/${base}`);
      git('branch', '-q', `--set-upstream-to=origin/${base}`);
    } else {
      commit('README.md', 'base');
      git('push', '-q', '-u', 'origin', base);
    }
    git('checkout', '-qb', branch);
    commit('export.ts', `${key} add export`);
    git('push', '-q', '-u', 'origin', branch);
    host = resolveHost(root, { cwd: repoRoot }) as GitHubHost;
  });

  afterAll(async () => {
    try {
      git('push', '-q', 'origin', '--delete', branch); // also closes the PR if it wasn't merged
    } catch {
      /* already gone */
    }
    if (jira && key) await jira.deleteIssue(key);
    rmSync(root, { recursive: true, force: true });
  });

  it('resolves GitHub from the origin remote', () => {
    expect(host.kind).toBe('github');
    expect(host.repoId).toBe(testRepo);
  });

  it('opens a PR (title from Jira when configured), is idempotent, updates after a push', async () => {
    const open = () => openPr({ root, host, jira, state: new StateFile(root), base });
    const r = await open();
    expect(r.action).toBe('created');
    expect(r.pr!.url).toMatch(new RegExp(`^https://github.com/${testRepo}/pull/\\d+$`));
    if (jira) {
      expect(r.title).toBe(`${key}: ${run} GitHub PR test`);
      const links = await jira.http.get<{ object: { url: string } }[]>(`/rest/api/2/issue/${key}/remotelink`);
      expect(links.map((l) => l.object.url)).toContain(r.pr!.url);
    }
    expect((await open()).action).toBe('unchanged');
    commit('export2.ts', `${key} progress`);
    git('push', '-q');
    expect((await open()).action).toBe('updated');
    expect(await host.prBody(r.pr!)).toContain(`${key} progress`);
  });

  it('publishes one review comment, updated in place; summary only (no annotations on GitHub)', async () => {
    mkdirSync(join(root, '.sdlc', 'reviews'), { recursive: true });
    const f = join(root, '.sdlc', 'reviews', 'r.md');
    const write = (findings: string) => writeFileSync(f, `---\nbase: ${base}\nfindings: ${findings}\n---\n# Review\n\nSummary.\n`);
    write('\n  - { severity: high, file: export.ts, line: 1, title: Not escaped }');
    const a = await publishReview({ root, host, jira, file: f, base });
    expect(a).toMatchObject({ verdict: 'changes_requested', comment: 'created', annotations: false });
    expect((await publishReview({ root, host, jira, file: f, base })).comment).toBe('unchanged');
    write('[]');
    expect(await publishReview({ root, host, jira, file: f, base })).toMatchObject({ verdict: 'approved', comment: 'updated' });

    const pr = (await host.findOpenPr(branch, base))!;
    const comments = await host['http'].get<{ body: string }[]>(`/repos/${testRepo}/issues/${pr.id}/comments`);
    expect(comments.filter((c) => c.body.includes('<!-- sdlc-review -->'))).toHaveLength(1);
  });

  it.skipIf(!cfg.jira)('doneWhen "merged": Done only after the GitHub PR is merged', async () => {
    await importTicket({ jira: jira!, root, key, engine: new PivEngine(), state: new StateFile(root) });
    for (const [dir, body] of [
      ['plans', '# Feature'],
      ['execution-reports', '### Validation Results\n\n- Tests: ✓'],
    ] as const) {
      mkdirSync(join(root, '.claude', dir), { recursive: true });
      writeFileSync(join(root, '.claude', dir, `${key.toLowerCase()}-gh.md`), body);
    }
    const sync = () => syncProgress({ jira: jira!, root, state: new StateFile(root), engineFor: () => new PivEngine(), doneWhen: 'merged', prState: async (id) => (await host.getPr(id))?.state });
    expect((await sync()).tickets[0]).toMatchObject({ status: 'complete', transition: { to: 'In Progress' } });

    const pr = (await host.findOpenPr(branch, base))!;
    await host['http'].request('PUT', `/repos/${testRepo}/pulls/${pr.id}/merge`, { body: { merge_method: 'squash' } });
    expect((await host.getPr(pr.id))?.state).toBe('merged');
    expect((await sync()).tickets[0]).toMatchObject({ transition: { to: 'Done', action: 'moved' } });
  });
});
