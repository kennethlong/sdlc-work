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
 *   ---
 *   # Code review: <branch>
 *   <summary for humans>
 */
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { Finding, GitHost } from './hosts/types.ts';

export const REVIEW_MARKER = '<!-- sdlc-review -->';
export type Verdict = 'approved' | 'comments' | 'changes_requested';
export type Review = { base?: string; head?: string; verdict: Verdict; findings: Finding[]; summary: string; path: string };

const SEVERITIES: Finding['severity'][] = ['critical', 'high', 'medium', 'low'];
export const isBlocking = (f: Finding) => f.severity === 'critical' || f.severity === 'high';

export function readReview(path: string): Review {
  const text = readFileSync(path, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) throw new Error(`${path}: missing YAML front matter with findings`);
  // A short SHA like 1234567 or 12e4567 would parse as a number; commit and branch names are always strings.
  const front = m[1]!.replace(/^(head|base):[ \t]*([^'"\s#][^\s#]*)[ \t]*$/gm, '$1: "$2"');
  const meta = (parseYaml(front) ?? {}) as { base?: string; head?: string; verdict?: string; findings?: Partial<Finding>[] };
  const findings = (meta.findings ?? []).map((f, i): Finding => {
    const severity = String(f.severity ?? '').toLowerCase() as Finding['severity'];
    if (!SEVERITIES.includes(severity)) throw new Error(`${path}: finding ${i + 1} has severity "${f.severity}" (expected ${SEVERITIES.join('|')})`);
    if (!f.file || !f.title) throw new Error(`${path}: finding ${i + 1} needs file and title`);
    return { ...f, severity, file: String(f.file).replace(/\\/g, '/'), line: f.line ? Number(f.line) : undefined, title: String(f.title) } as Finding;
  });
  const verdict = (meta.verdict as Verdict) ?? (findings.some(isBlocking) ? 'changes_requested' : findings.length ? 'comments' : 'approved');
  if (!['approved', 'comments', 'changes_requested'].includes(verdict)) throw new Error(`${path}: verdict "${meta.verdict}" is not approved|comments|changes_requested`);
  // Order by severity so the most important findings lead everywhere they are shown.
  findings.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
  return { base: meta.base, head: meta.head, verdict, findings, summary: text.slice(m[0].length).trim(), path };
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
  if (review.findings.length) {
    lines.push('| # | Severity | Location | Finding |', '|---|---|---|---|');
    review.findings.forEach((f, i) => {
      const loc = `[${f.file}${f.line ? `:${f.line}` : ''}](${host.fileUrl(f.file, f.line, ref)})`;
      lines.push(`| ${i + 1} | ${f.severity} | ${loc} | ${f.title.replace(/\|/g, '\\|')} |`);
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
  return [
    `Code review ${ICON[review.verdict]} **${LABEL[review.verdict]}** (${countLine(review.findings)}) on [the pull request](${prUrl}).`,
    ...(top.length ? ['', ...top.map((f) => `- ${f.severity}: ${f.title} (\`${f.file}${f.line ? `:${f.line}` : ''}\`)`)] : []),
  ].join('\n');
}

function stripHeading(md: string) {
  return md.replace(/^#\s+[^\n]*\n+/, '');
}
