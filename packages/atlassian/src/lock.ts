/**
 * Cross-process lock files. Creation is atomic (`wx`), and the file records its owner's PID: a lock whose owner is
 * still running is never taken over, however old; one whose owner is gone (a crashed run) is. A lock without a
 * readable PID is only taken over once it is older than `staleMs`.
 */
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'; // exists, owned by someone else
  }
}

/** Try once to take the lock. Returns a release function, or undefined when another live process holds it. */
export function tryLock(path: string, staleMs = 10 * 60_000): (() => void) | undefined {
  mkdirSync(dirname(path), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, 'wx');
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return () => rmSync(path, { force: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    if (!isAbandoned(path, staleMs)) return undefined;
    rmSync(path, { force: true }); // take over, then retry the atomic create once
  }
  return undefined;
}

function isAbandoned(path: string, staleMs: number): boolean {
  try {
    const pid = Number(readFileSync(path, 'utf8').trim());
    if (pid) return !pidAlive(pid);
    return Date.now() - statSync(path).mtimeMs >= staleMs;
  } catch {
    return true; // released between our create and our read
  }
}

/** Take the lock, waiting up to `waitMs` (synchronously; for short critical sections). */
export function lockSync(path: string, waitMs = 10_000): () => void {
  const until = Date.now() + waitMs;
  const nap = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    const release = tryLock(path);
    if (release) return release;
    if (Date.now() >= until) throw new Error(`Timed out waiting for ${path} (held by another sdlc-atl process).`);
    Atomics.wait(nap, 0, 0, 50);
  }
}
