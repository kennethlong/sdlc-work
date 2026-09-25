// Test harness: the same scenarios run against every engine's fixture. Each case knows its fixture, item ids and
// how to simulate "executed with gaps" / "passed" in that engine's own artifact format.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findGsdTools, GsdEngine, PivEngine } from '../src/engines/index.ts';
import type { Engine } from '../src/work.ts';

export type EngineCase = {
  name: 'gsd' | 'piv';
  fixture: string;
  available: boolean;
  engine: () => Engine;
  /** ids of the fixture's 3 items, in order. */
  ids: [string, string, string];
  /** Verdict word the engine reports for a failed verification. */
  failedStatus: string;
  /** Simulate item 2 executed and verified with problems / verified clean. */
  failItem2: (root: string) => void;
  passItem2: (root: string) => void;
};

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}-project`, import.meta.url));

const gsdAvailable = (() => {
  try {
    return !!findGsdTools(fixture('gsd'));
  } catch {
    return false;
  }
})();

const gsdVerification = (root: string, status: string, score: string) => {
  const dir = join(root, '.planning', 'phases', '02-export-ui');
  writeFileSync(join(dir, '02-01-SUMMARY.md'), '---\nphase: 02-export-ui\nplan: 01\n---\n\n# Summary\n');
  writeFileSync(
    join(dir, '02-VERIFICATION.md'),
    `---\nphase: 02-export-ui\nverified: 2026-09-24T12:00:00Z\nstatus: ${status}\nscore: ${score}\n---\n\n# Phase 2: Export UI Verification Report\n\n**Status:** ${status}\n`,
  );
};

const pivReport = (root: string, unit: string) =>
  writeFileSync(
    join(root, '.claude', 'execution-reports', 'ticket-2-export-ui.md'),
    `# Execution Report: Export UI\n\n### Validation Results\n\n- Syntax & Linting: ✓\n- Type Checking: ✓\n- Unit Tests: ${unit}\n\n### What Went Well\n\n- Button renders.\n`,
  );

export const ENGINE_CASES: EngineCase[] = [
  {
    name: 'gsd',
    fixture: fixture('gsd'),
    available: gsdAvailable,
    engine: () => new GsdEngine(),
    ids: ['1', '2', '3'],
    failedStatus: 'gaps_found',
    failItem2: (root) => gsdVerification(root, 'gaps_found', '1/2 must-haves verified'),
    passItem2: (root) => gsdVerification(root, 'passed', '2/2 must-haves verified'),
  },
  {
    name: 'piv',
    fixture: fixture('piv'),
    available: true,
    engine: () => new PivEngine(),
    ids: ['TICKET-1', 'TICKET-2', 'TICKET-3'],
    failedStatus: 'failed',
    failItem2: (root) => pivReport(root, '✗ 11 passed, 2 failed'),
    passItem2: (root) => pivReport(root, '✓ 13 passed, 0 failed'),
  },
];
