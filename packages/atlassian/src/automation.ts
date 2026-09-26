/**
 * Automation: keep Jira/Confluence in step without anyone remembering to run `sync`.
 *
 * A git post-commit hook works for every agent and for humans (portable, unlike agent-specific hooks). GSD commits
 * its planning docs (`commit_docs`), and PIV plans/reports are committed with the work, so "a commit touched a
 * planning artifact" is exactly when progress may have changed. The hook runs `sync` in the background, never
 * blocks or fails the commit, and logs to `.sdlc/sync.log`.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { tryLock } from './lock.ts';

const START = '# >>> sdlc-atl sync >>>';
const END = '# <<< sdlc-atl sync <<<';
/** Paths whose change means planning progress may have moved. */
export const WATCHED = String.raw`^(\.planning/|\.claude/(plans|execution-reports)/|docs/(specs|rca)/)`;

function hookPath(root: string): string {
  const dir = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], { cwd: root, encoding: 'utf8' }).trim();
  return resolve(root, dir, 'post-commit'); // `dir` is absolute when core.hooksPath is
}

/** Shell-quoted command that runs this CLI (node + script), so the hook doesn't depend on PATH. */
export function selfCommand(script = process.argv[1]!): string {
  const q = (s: string) => `"${s.replace(/\\/g, '/').replace(/"/g, '\\"')}"`;
  return `${q(process.execPath)} ${q(script)}`;
}

export function installHook(root: string, command = selfCommand()): { path: string; action: 'installed' | 'updated' } {
  const path = hookPath(root);
  const block = [
    START,
    '# Installed by `sdlc-atl hooks install`; remove with `sdlc-atl hooks uninstall`.',
    `if git diff-tree --no-commit-id --name-only -r HEAD | grep -qE '${WATCHED}'; then`,
    '  mkdir -p .sdlc',
    `  ( ${command} sync --quiet >> .sdlc/sync.log 2>&1 & ) >/dev/null 2>&1`,
    'fi',
    END,
  ].join('\n');
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const action = existing.includes(START) ? 'updated' : 'installed';
  const body = existing.includes(START) ? replaceBlock(existing, block) : `${existing.trim() ? existing.trimEnd() + '\n\n' : '#!/bin/sh\n\n'}${block}\n`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
  try {
    chmodSync(path, 0o755);
  } catch {
    // Windows: git runs hooks through its own sh regardless of mode bits
  }
  return { path, action };
}

export function uninstallHook(root: string): boolean {
  const path = hookPath(root);
  if (!existsSync(path)) return false;
  const text = readFileSync(path, 'utf8');
  if (!text.includes(START)) return false;
  const rest = replaceBlock(text, '').replace(/\n{3,}/g, '\n\n').trim();
  if (!rest || rest === '#!/bin/sh') rmSync(path);
  else writeFileSync(path, rest + '\n');
  return true;
}

export function hookInstalled(root: string): boolean {
  const path = hookPath(root);
  return existsSync(path) && readFileSync(path, 'utf8').includes(START);
}

function replaceBlock(text: string, block: string): string {
  const s = text.indexOf(START);
  const e = text.indexOf(END, s);
  return text.slice(0, s) + block + text.slice(e + END.length);
}

/**
 * Cross-process lock so overlapping hook runs don't race (two quick commits): the second run skips ('locked').
 * A lock held by a live process is never taken over; one left by a crashed run is (see lock.ts).
 */
export function withLock<T>(root: string, fn: () => Promise<T>, staleMs = 10 * 60_000): Promise<T | 'locked'> {
  const release = tryLock(join(root, '.sdlc', 'sync.lock'), staleMs);
  if (!release) return Promise.resolve('locked');
  return fn().finally(release);
}
