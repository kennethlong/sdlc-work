import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lockSync, tryLock } from '../src/lock.ts';
import { mergeState, StateFile } from '../src/state.ts';

const dir = () => mkdtempSync(join(tmpdir(), 'sdlc-state-'));

describe('StateFile', () => {
  it('keeps both processes\' writes when they save in turn (no lost updates)', () => {
    const root = dir();
    new StateFile(root).save();
    const hook = new StateFile(root); // e.g. a background sync, loaded first
    const pr = new StateFile(root); // `sdlc-atl pr`, loaded at the same time
    pr.data.prs = { 'feature/X-1': { id: '7', url: 'u', host: 'github', repo: 'o/r', key: 'X-1' } };
    pr.save();
    hook.data.items['TICKET-1'] = { issueKey: 'X-1', verificationPageId: '42' };
    hook.save();
    const disk = JSON.parse(readFileSync(join(root, '.sdlc', 'atlassian.json'), 'utf8'));
    expect(disk.prs['feature/X-1'].id).toBe('7');
    expect(disk.items['TICKET-1'].verificationPageId).toBe('42');
    expect(readdirSync(join(root, '.sdlc')).filter((f) => f.endsWith('.tmp') || f.endsWith('.lock'))).toEqual([]);
  });

  it('applies deletions and scalar changes, and leaves untouched keys as they are on disk', () => {
    const base = { epic: 'E-1', items: { a: { issueKey: 'X-1' }, b: { issueKey: 'X-2' } } };
    const mine = { epic: 'E-2', items: { a: { issueKey: 'X-1' } } };
    const disk = { epic: 'E-1', breakdownPageId: '9', items: { a: { issueKey: 'X-1', verificationPageId: '5' }, b: { issueKey: 'X-2' }, c: { issueKey: 'X-3' } } };
    expect(mergeState(base, mine, disk)).toEqual({
      epic: 'E-2',
      breakdownPageId: '9',
      items: { a: { issueKey: 'X-1', verificationPageId: '5' }, c: { issueKey: 'X-3' } },
    });
  });
});

describe('lock', () => {
  it('is exclusive while its owner is alive, and released afterwards', () => {
    const path = join(dir(), 'x.lock');
    const release = tryLock(path)!;
    expect(release).toBeTypeOf('function');
    expect(tryLock(path)).toBeUndefined(); // our own (live) PID holds it
    release();
    expect(existsSync(path)).toBe(false);
    expect(tryLock(path)).toBeTypeOf('function');
  });

  it('takes over a lock left by a process that no longer exists, however recent', () => {
    const path = join(dir(), 'x.lock');
    writeFileSync(path, '2147483646'); // no such PID
    const release = tryLock(path);
    expect(release).toBeTypeOf('function');
    expect(readFileSync(path, 'utf8')).toBe(String(process.pid));
  });

  it('lockSync times out instead of waiting forever', () => {
    const path = join(dir(), 'x.lock');
    tryLock(path);
    expect(() => lockSync(path, 150)).toThrow(/Timed out/);
  });
});
