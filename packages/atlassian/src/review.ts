/**
 * Code review files and their publication. The review itself is agent work (the `review` skill); this is the
 * deterministic part: a parseable findings format, the PR comment / Code Insights / Jira rendering, and the gate.
 *
 * Review file (`.sdlc/reviews/<branch-slug>.md`), findings in YAML front matter, the reference's fields
 * (severity, file, line, issue -> title, detail, suggestion):
 *
 *   ---
 *   base: main
 *   head: 3f2c1ab
 *   verdict: changes_requested | approved | comments
 *   findings:
 *     - severity: high          # critical | high | medium | low
 *       category: security      # bug | security | performance | quality | tests | standards
 *       file: src/export.ts
 *       line: 42
 *       title: CSV cells are not escaped against formula injection
 *       detail: ...
 *       suggestion: ...
 *   stats:                      # optional; from `sdlc-atl review-scope` (the reference's Stats block)
 *     files_added: 1
 *     files_modified: 2
 *     files_deleted: 0
 *     lines_added: 120
 *     lines_deleted: 14
 *   ---
 *   # Code review: <branch>
 *   <summary for humans>
 */
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { Finding, GitHost } from './hosts/types.ts';

export const REVIEW_MARKER = '<!-- sdlc-review -->';
export type Verdict = 'approved' | 'comments' | 'changes_requested';
export type ReviewStats = { filesAdded?: number; filesModified?: number; filesDeleted?: number; linesAdded?: number; linesDeleted?: number };
export type Review = { base?: string; head?: string; verdict: Verdict; findings: Finding[]; summary: string; path: string; stats?: ReviewStats };

/** Finding categories, in display order. `quality` is the reference's "Code Quality" (DRY, complexity, naming). */
export const CATEGORIES = ['bug', 'security', 'performance', 'quality', 'tests', 'standards'] as const;
const CATEGORY_ALIASES: Record<string, string> = {
  logic: 'bug', correctness: 'bug', bugs: 'bug', vulnerability: 'security', perf: 'performance',
  'code quality': 'quality', 'code-quality': 'quality', maintainability: 'quality', readability: 'quality',
  test: 'tests', testing: 'tests', standard: 'standards', conventions: 'standards', style: 'standards',
};

/** Lower-case and map common synonyms onto the known categories; anything else is kept as written. */
export function normaliseCategory(c: unknown): string | undefined {
  if (c === undefined || c === null || c === '') return undefined;
  const k = String(c).trim().toLowerCase();
  return CATEGORY_ALIASES[k] ?? k;
}

const SEVERITIES: Finding['severity'][] = ['critical', 'high', 'medium', 'low'];
export const isBlocking = (f: Finding) => f.severity === 'critical' || f.severity === 'high';

export function readReview(path: string): Review {
  const text = readFileSync(path, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) throw new Error(`${path}: missing YAML front matter with findings`);
  // A short SHA like 1234567 or 12e4567 would parse as a number; commit and branch names are always strings.
  const front = m[1]!.replace(/^(head|base):[ \t]*([^'"\s#][^\s#]*)[ \t]*$/gm, '$1: "$2"');
  const meta = (parseYaml(front) ?? {}) as { base?: string; head?: string; verdict?: string; findings?: Partial<Finding>[]; stats?: Record<string, unknown> };
  const findings = (meta.findings ?? []).map((f, i): Finding => {
    const severity = String(f.severity ?? '').toLowerCase() as Finding['severity'];
    if (!SEVERITIES.includes(severity)) throw new Error(`${path}: finding ${i + 1} has severity "${f.severity}" (expected ${SEVERITIES.join('|')})`);
    if (!f.file || !f.title) throw new Error(`${path}: finding ${i + 1} needs file and title`);
    const category = normaliseCategory(f.category);
    return { ...f, severity, ...(category ? { category } : { category: undefined }), file: String(f.file).replace(/\\/g, '/'), line: f.line ? Number(f.line) : undefined, title: String(f.title) } as Finding;
  });
  const verdict = (meta.verdict as Verdict) ?? (findings.some(isBlocking) ? 'changes_requested' : findings.length ? 'comments' : 'approved');
  if (!['approved', 'comments', 'changes_requested'].includes(verdict)) throw new Error(`${path}: verdict "${meta.verdict}" is not approved|comments|changes_requested`);
  // Order by severity so the most important findings lead everywhere they are shown.
  findings.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
  const stats = readStats(meta.stats);
  return { base: meta.base, head: meta.head, verdict, findings, summary: text.slice(m[0].length).trim(), path, ...(stats ? { stats } : {}) };
}

function readStats(raw: Record<string, unknown> | undefined): ReviewStats | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const num = (...keys: string[]) => {
    for (const k of keys) if (raw[k] !== undefined && raw[k] !== null && !Number.isNaN(Number(raw[k]))) return Number(raw[k]);
    return undefined;
  };
  const stats: ReviewStats = {
    filesAdded: num('files_added', 'filesAdded'),
    filesModified: num('files_modified', 'filesModified'),
    filesDeleted: num('files_deleted', 'filesDeleted'),
    linesAdded: num('lines_added', 'linesAdded', 'insertions'),
    linesDeleted: num('lines_deleted', 'linesDeleted', 'deletions'),
  };
  return Object.values(stats).some((v) => v !== undefined) ? stats : undefined;
}

/** Findings per category: known categories in order, then others, then "uncategorised". */
export function categoryCounts(findings: Finding[]): [string, number][] {
  const m = new Map<string, number>();
  for (const f of findings) {
    const c = f.category ?? 'uncategorised';
    m.set(c, (m.get(c) ?? 0) + 1);
  }
  const known = CATEGORIES as readonly string[];
  const order = (c: string) => (c === 'uncategorised' ? 99 : known.includes(c) ? known.indexOf(c) : 50);
  return [...m.entries()].sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]));
}

function categoryLine(findings: Finding[]): string {
  return categoryCounts(findings)
    .map(([c, n]) => `${c} ${n}`)
    .join(' · ');
}

/** "3 files (1 added, 2 modified) · +120 −14 lines", or undefined without stats. */
export function statsLine(s: ReviewStats | undefined): string | undefined {
  if (!s) return undefined;
  const files = [s.filesAdded && `${s.filesAdded} added`, s.filesModified && `${s.filesModified} modified`, s.filesDeleted && `${s.filesDeleted} deleted`].filter(Boolean);
  const total = (s.filesAdded ?? 0) + (s.filesModified ?? 0) + (s.filesDeleted ?? 0);
  const parts = [
    total ? `${total} file${total === 1 ? '' : 's'}${files.length ? ` (${files.join(', ')})` : ''}` : undefined,
    s.linesAdded !== undefined || s.linesDeleted !== undefined ? `+${s.linesAdded ?? 0} −${s.linesDeleted ?? 0} lines` : undefined,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

export function counts(findings: Finding[]) {
  return Object.fromEntries(SEVERITIES.map((s) => [s, findings.filter((f) => f.severity === s).length])) as Record<Finding['severity'], number>;
}

const ICON: Record<Verdict, string> = { approved: '✅', comments: '💬', changes_requested: '❌' };
const LABEL: Record<Verdict, string> = { approved: 'approved', comments: 'comments', changes_requested: 'changes requested' };

function countLine(findings: Finding[]) {
  const c = counts(findings);
  return SEVERITIES.filter((s) => c[s]).map((s) => `${c[s]} ${s}`).join(', ') || 'no findings';
}

/** The single PR comment (updated in place on re-publish). */
export function renderPrComment(review: Review, host: GitHost, ref: string): string {
  const lines = [`## ${ICON[review.verdict]} Code review: ${LABEL[review.verdict]}`, '', `**${countLine(review.findings)}**${review.base ? ` · compared with \`${review.base}\`` : ''} · commit \`${ref.slice(0, 10)}\``, ''];
  const stats = statsLine(review.stats);
  if (stats) lines.push(`**Changes:** ${stats}`, '');
  if (review.findings.length) {
    lines.push(`**By category:** ${categoryLine(review.findings)}`, '');
    lines.push('| # | Severity | Category | Location | Finding |', '|---|---|---|---|---|');
    review.findings.forEach((f, i) => {
      const loc = `[${f.file}${f.line ? `:${f.line}` : ''}](${host.fileUrl(f.file, f.line, ref)})`;
      lines.push(`| ${i + 1} | ${f.severity} | ${f.category ?? ''} | ${loc} | ${f.title.replace(/\|/g, '\\|')} |`);
    });
    lines.push('');
    review.findings.forEach((f, i) => {
      if (!f.detail && !f.suggestion) return;
      lines.push(`**${i + 1}. ${f.title}**`, '');
      if (f.detail) lines.push(f.detail.trim(), '');
      if (f.suggestion) lines.push(`_Suggestion:_ ${f.suggestion.trim()}`, '');
    });
  }
  if (review.summary) lines.push('---', '', stripHeading(review.summary), '');
  lines.push(`_Posted by sdlc-atl from \`${review.path.replace(/\\/g, '/').split('/').slice(-3).join('/')}\`; re-publishing updates this comment._`);
  return lines.join('\n');
}

/** Short Jira comment: verdict, counts, where to look. */
export function renderJiraComment(review: Review, prUrl: string): string {
  const top = review.findings.filter(isBlocking).slice(0, 5);
  const stats = statsLine(review.stats);
  return [
    `Code review ${ICON[review.verdict]} **${LABEL[review.verdict]}** (${countLine(review.findings)}) on [the pull request](${prUrl}).`,
    ...(review.findings.length || stats ? [''] : []),
    ...(review.findings.length ? [`By category: ${categoryLine(review.findings)}`] : []),
    ...(stats ? [`Changes: ${stats}`] : []),
    ...(top.length ? ['', ...top.map((f) => `- ${f.severity}: ${f.title} (\`${f.file}${f.line ? `:${f.line}` : ''}\`)`)] : []),
  ].join('\n');
}

function stripHeading(md: string) {
  return md.replace(/^#\s+[^\n]*\n+/, '');
}
