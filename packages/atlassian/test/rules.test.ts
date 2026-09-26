import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureRulesFiles } from '../src/rules.ts';

const repo = () => mkdtempSync(join(tmpdir(), 'sdlc-rules-'));
const read = (root: string, f: string) => readFileSync(join(root, f), 'utf8');

describe('ensureRulesFiles', () => {
  it('creates AGENTS.md and a CLAUDE.md that imports it in a fresh repo; idempotent', () => {
    const root = repo();
    expect(ensureRulesFiles(root).map((r) => r.action)).toEqual(['created', 'created']);
    expect(read(root, 'CLAUDE.md')).toMatch(/^@AGENTS\.md$/m);
    expect(ensureRulesFiles(root).map((r) => r.action)).toEqual(['ok', 'ok']);
  });

  it('adds the import to an existing CLAUDE.md without touching its content', () => {
    const root = repo();
    writeFileSync(join(root, 'AGENTS.md'), '# Rules\n');
    writeFileSync(join(root, 'CLAUDE.md'), 'Use the Task tool for searches.');
    expect(ensureRulesFiles(root)).toEqual([{ file: 'AGENTS.md', action: 'ok' }, { file: 'CLAUDE.md', action: 'import-added' }]);
    expect(read(root, 'CLAUDE.md')).toBe('Use the Task tool for searches.\n\n@AGENTS.md\n');
  });

  it('only advises when the rules live in CLAUDE.md', () => {
    const root = repo();
    writeFileSync(join(root, 'CLAUDE.md'), '# Rules\n- Always run npm test\n');
    const r = ensureRulesFiles(root);
    expect(r).toEqual([expect.objectContaining({ file: 'AGENTS.md', action: 'advice' })]);
    expect(read(root, 'CLAUDE.md')).toBe('# Rules\n- Always run npm test\n');
  });

  it('dry run changes nothing', () => {
    const root = repo();
    expect(ensureRulesFiles(root, { dryRun: true }).map((r) => r.action)).toEqual(['created', 'created']);
    expect(() => read(root, 'AGENTS.md')).toThrow();
  });
});
