// Test harness: the same scenarios run against every engine's fixture. Each case knows its fixture, item ids and
// how to simulate progress (planned / verified with gaps / passed) in that engine's own artifact format.
import { mkdirSync, writeFileSync } from 'node:fs';
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
  /** Track A: simulate item 2 executed and verified with problems / verified clean. */
  failItem2: (root: string) => void;
  passItem2: (root: string) => void;
  /** Track B: simulate work planned / executed + verified (passed) for a Jira key. */
  planTicket: (root: string, key: string) => void;
  passTicket: (root: string, key: string) => void;
};

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}-project`, import.meta.url));

const gsdAvailable = (() => {
  try {
    return !!findGsdTools(fixture('gsd'));
  } catch {
    return false;
  }
})();

const write = (dir: string, file: string, lines: string[]) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), lines.join('\n') + '\n');
};

// --- gsd -----------------------------------------------------------------------------------

const gsdVerification = (root: string, status: string, score: string) => {
  const dir = join(root, '.planning', 'phases', '02-export-ui');
  write(dir, '02-01-SUMMARY.md', ['---', 'phase: 02-export-ui', 'plan: 01', '---', '', '# Summary']);
  write(dir, '02-VERIFICATION.md', ['---', 'phase: 02-export-ui', 'verified: 2026-09-24T12:00:00Z', `status: ${status}`, `score: ${score}`, '---', '', '# Phase 2: Export UI Verification Report', '', `**Status:** ${status}`]);
};

// A GSD quick task started as "<KEY>: export button" gets a slug containing the key.
const quickDir = (root: string, key: string) => join(root, '.planning', 'quick', `260924-001-${key.toLowerCase()}-export-button`);

// --- piv -----------------------------------------------------------------------------------

const pivReport = (root: string, unit: string) =>
  write(join(root, '.claude', 'execution-reports'), 'ticket-2-export-ui.md', [
    '# Execution Report: Export UI',
    '',
    '### Validation Results',
    '',
    '- Syntax & Linting: ✓',
    '- Type Checking: ✓',
    `- Unit Tests: ${unit}`,
    '',
    '### What Went Well',
    '',
    '- Button renders.',
  ]);

const pivName = (key: string) => `${key.toLowerCase()}-export-button.md`;

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
    planTicket: (root, key) => write(quickDir(root, key), '260924-001-PLAN.md', [`# Quick task: ${key} export button`]),
    passTicket: (root, key) => {
      write(quickDir(root, key), '260924-001-SUMMARY.md', ['---', 'status: complete', '---', '', '# Summary']);
      write(quickDir(root, key), '260924-001-VERIFICATION.md', ['---', 'status: passed', 'score: 2/2 must-haves verified', '---', '', '# Quick task verification', '', 'All good.']);
    },
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
    planTicket: (root, key) => write(join(root, '.claude', 'plans'), pivName(key), [`# Feature: ${key} export button`]),
    passTicket: (root, key) =>
      write(join(root, '.claude', 'execution-reports'), pivName(key), ['# Execution Report', '', '### Validation Results', '', '- Lint: ✓', '- Unit Tests: ✓ 9 passed']),
  },
];

/** Jira project and Confluence space the live suites write to (defaults match the local DC stack). */
export const TEST_PROJECT = process.env.SDLC_TEST_PROJECT ?? 'SDLC';
export const TEST_SPACE = process.env.SDLC_TEST_SPACE ?? 'SDLC';
