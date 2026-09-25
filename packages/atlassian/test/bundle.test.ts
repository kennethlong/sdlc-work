import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

describe('plugin bundle', () => {
  it('plugins/sdlc/bin is up to date with the source (run `npm run bundle`)', { timeout: 60_000 }, () => {
    const repo = fileURLToPath(new URL('../../..', import.meta.url));
    expect(() => execFileSync(process.execPath, ['scripts/bundle.mjs', '--check'], { cwd: repo, stdio: 'pipe' })).not.toThrow();
  });
});
