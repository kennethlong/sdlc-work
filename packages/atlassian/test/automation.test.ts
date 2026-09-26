import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hookInstalled, installHook, selfCommand, uninstallHook, withLock } from '../src/automation.ts';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

async function waitFor(check: () => boolean, ms = 15_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

describe('post-commit hook', () => {
  it('runs sync in the background only for commits that touch planning artifacts; preserves other hooks', { timeout: 60_000 }, async () => {
    const repo = mkdtempSync(join(tmpdir(), 'sdlc-hook-'));
    try {
      git(repo, 'init', '-q', '-b', 'main');
      git(repo, 'config', 'user.email', 't@example.com');
      git(repo, 'config', 'user.name', 't');
      // An existing hook must survive install/uninstall.
      const hooks = join(repo, '.git', 'hooks');
      mkdirSync(hooks, { recursive: true });
      writeFileSync(join(hooks, 'post-commit'), '#!/bin/sh\necho existing >> existing.log\n');

      // Stand-in for the CLI: records its arguments.
      const fake = join(repo, 'fake-cli.mjs');
      writeFileSync(fake, "import { appendFileSync } from 'node:fs'; appendFileSync('calls.log', process.argv.slice(2).join(' ') + '\\n');\n");
      const r = installHook(repo, selfCommand(fake));
      expect(r.action).toBe('installed');
      expect(hookInstalled(repo)).toBe(true);
      expect(installHook(repo, selfCommand(fake)).action).toBe('updated'); // idempotent

      writeFileSync(join(repo, 'README.md'), 'hi');
      git(repo, 'add', 'README.md');
      git(repo, 'commit', '-q', '-m', 'unrelated');
      expect(await waitFor(() => existsSync(join(repo, 'existing.log')))).toBe(true);
      await new Promise((res) => setTimeout(res, 1500));
      expect(existsSync(join(repo, 'calls.log'))).toBe(false);

      mkdirSync(join(repo, '.planning', 'phases', '01-x'), { recursive: true });
      writeFileSync(join(repo, '.planning', 'phases', '01-x', '01-VERIFICATION.md'), '---\nstatus: passed\n---\n');
      git(repo, 'add', '.');
      git(repo, 'commit', '-q', '-m', 'verify phase 1');
      expect(await waitFor(() => existsSync(join(repo, 'calls.log')))).toBe(true);
      expect(readFileSync(join(repo, 'calls.log'), 'utf8').trim()).toBe('sync --quiet');

      expect(uninstallHook(repo)).toBe(true);
      expect(hookInstalled(repo)).toBe(false);
      expect(readFileSync(join(hooks, 'post-commit'), 'utf8')).toContain('echo existing');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe('withLock', () => {
  it('skips while another run holds the lock, and releases afterwards', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sdlc-lock-'));
    try {
      let inner: unknown;
      const outer = await withLock(root, async () => {
        inner = await withLock(root, async () => 'second');
        return 'first';
      });
      expect([outer, inner]).toEqual(['first', 'locked']);
      expect(await withLock(root, async () => 'again')).toBe('again');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('hook location', () => {
  it('honours an absolute core.hooksPath', () => {
    const repo = mkdtempSync(join(tmpdir(), 'sdlc-hookpath-'));
    const shared = mkdtempSync(join(tmpdir(), 'sdlc-shared-hooks-'));
    try {
      git(repo, 'init', '-q', '-b', 'main');
      git(repo, 'config', 'core.hooksPath', shared);
      installHook(repo, selfCommand(join(repo, 'cli.mjs')));
      expect(existsSync(join(shared, 'post-commit'))).toBe(true);
      expect(hookInstalled(repo)).toBe(true);
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(shared, { recursive: true, force: true });
    }
  });
});
