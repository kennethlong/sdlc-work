import { existsSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { readText } from './text.ts';
import type { Breakdown, Engine, LoadOptions, TicketProgress, Verification, WorkItem, WorkStatus } from '../work.ts';

/**
 * Reference-style engine ("PIV": prime → plan-feature → execute → validate), reading the artifacts the
 * reference's skills write:
 *   docs/specs/<epic>.md                 `/spec` ticket breakdown: "### TICKET-1 — <title>" sections
 *   .claude/plans/<name>.md              `/sdlc:plan` output (the reference's `/plan-feature`): the ticket is planned
 *   .claude/execution-reports/<name>.md  `/sdlc:report` output: its ✓/✗ "Validation Results" are the verdict
 *
 * The reference never links a plan or report back to its ticket, so (deviation) an artifact belongs to a ticket
 * when its file name starts with the ticket id or Jira key ("ticket-1-…", "sdlc-5-…"), or it has a
 * "Ticket: TICKET-1" / "Ticket: SDLC-5" line.
 */
export class PivEngine implements Engine {
  readonly name = 'piv' as const;
  private readonly specPath?: string;

  constructor(opts: { spec?: string } = {}) {
    this.specPath = opts.spec;
  }

  detect(root: string) {
    return specFiles(root).length > 0;
  }

  async loadBreakdown(root: string, opts: LoadOptions = {}): Promise<Breakdown> {
    const specRel = this.specPath ?? pickSpec(root);
    const spec = parseSpec(readText(join(root, specRel)));
    const plans = artifacts(root, join('.claude', 'plans'));
    const reports = artifacts(root, join('.claude', 'execution-reports'));

    const items: WorkItem[] = spec.tickets.map((t) => {
      const ids = [t.id, opts.issueKeys?.[t.id]].filter((x): x is string => !!x);
      const plan = plans.find((a) => belongsTo(a, ids));
      const report = reports.filter((a) => belongsTo(a, ids)).at(-1);
      const verification = report ? executionVerdict(report) : undefined;
      return {
        id: t.id,
        title: t.title,
        goal: t.goal,
        acceptanceCriteria: t.acceptanceCriteria,
        requirements: [],
        dependsOn: t.dependsOn,
        status: statusOf(!!plan, verification),
        source: `${specRel.split('\\').join('/')} (${t.id})`,
        verification,
        files: t.files,
        ...(t.issueType ? { issueType: t.issueType } : {}),
      };
    });
    return { engine: 'piv', title: spec.title, overview: spec.summary, items };
  }

  async ticketProgress(root: string, key: string): Promise<TicketProgress> {
    const plan = artifacts(root, join('.claude', 'plans')).filter((a) => belongsTo(a, [key]));
    const reports = artifacts(root, join('.claude', 'execution-reports')).filter((a) => belongsTo(a, [key]));
    const verification = reports.length ? executionVerdict(reports.at(-1)!) : undefined;
    return { status: statusOf(plan.length > 0, verification), verification, artifacts: [...plan, ...reports].map((a) => a.rel) };
  }

  nextSteps(key: string, summary: string, isBug: boolean): string[] {
    const slug = `${key.toLowerCase()}-${slugify(summary)}`;
    return isBug
      ? [
          `\`/sdlc:rca ${key}\`: root cause -> \`docs/rca/${key}.md\`, published to Confluence`,
          `\`/sdlc:fix ${key}\`: regression test first, then the fix and the prevention rule; the report goes to \`.claude/execution-reports/${key.toLowerCase()}-fix-${slugify(summary)}.md\``,
          '`/sdlc:sync`: moves the Jira issue and publishes the report',
        ]
      : [
          `\`/sdlc:prime ${key}\`, then \`/sdlc:plan ${key}\`: the plan is saved as \`.claude/plans/${slug}.md\``,
          '`/sdlc:execute` the plan, then `/sdlc:validate`',
          `\`/sdlc:report\`: saved as \`.claude/execution-reports/${slug}.md\` (its ✓/✗ results are the verdict)`,
          '`/sdlc:sync`: moves the Jira issue and publishes the report',
        ];
  }
}

export function slugify(s: string, max = 40): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, max)
    .replace(/-$/, '');
}

type Artifact = { rel: string; name: string; text: string };

function statusOf(planned: boolean, v?: Verification): WorkStatus {
  if (v) return v.status === 'passed' ? 'complete' : 'needs_attention';
  return planned ? 'planned' : 'not_started';
}

function specFiles(root: string): string[] {
  const dir = join(root, 'docs', 'specs');
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => join('docs', 'specs', f)) : [];
}

function pickSpec(root: string): string {
  const files = specFiles(root);
  if (files.length === 1) return files[0]!;
  if (!files.length) throw new Error(`No ticket breakdown in ${join(root, 'docs', 'specs')} (run /spec first).`);
  throw new Error(`Several specs in docs/specs (${files.map((f) => basename(f)).join(', ')}): set "spec" in .sdlc/config.json.`);
}

function artifacts(root: string, rel: string): Artifact[] {
  const dir = join(root, rel);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => ({ rel: join(rel, f).split('\\').join('/'), name: f.toLowerCase(), text: readText(join(dir, f)) }));
}

function belongsTo(a: Artifact, ids: string[]): boolean {
  return ids.some((id) => {
    const lower = id.toLowerCase();
    // "ticket-1-foo.md" but not "ticket-10-foo.md"
    if (a.name === `${lower}.md` || a.name.startsWith(`${lower}-`) || a.name.startsWith(`${lower}_`)) return true;
    return new RegExp(`^\\**ticket\\**:?\\**\\s*${escapeRe(id)}\\b`, 'im').test(a.text);
  });
}

/** An execution report's "Validation Results" ✓/✗ lines as a verification verdict. */
export function executionVerdict(a: Artifact): Verification {
  // The template says "Validation Results"; agents also write "## Validation" with a ✓/✗ table. Prefer the former.
  const section =
    a.text.match(/#+\s*Validation Results\s*\n([\s\S]*?)(?=\n#+\s|$)/i)?.[1] ?? a.text.match(/#+\s*Validation\b[^\n]*\n([\s\S]*?)(?=\n#+\s|$)/i)?.[1] ?? '';
  const checks = section.split('\n').filter((l) => /[✓✗✔✘]/.test(l));
  const failed = checks.filter((l) => /[✗✘]/.test(l)).length;
  return {
    status: checks.length === 0 ? 'unknown' : failed ? 'failed' : 'passed',
    score: checks.length ? `${checks.length - failed}/${checks.length} validation checks passed` : undefined,
    markdown: a.text.trim(),
    path: a.rel,
  };
}

export type SpecTicket = {
  id: string;
  title: string;
  goal: string;
  acceptanceCriteria: string[];
  dependsOn: string[];
  /** "Files touched" paths (estimates), for the parallel-work overlap check. */
  files: string[];
  /** "Type:" line (e.g. Task for chores); undefined = the repo default (Story). */
  issueType?: string;
};

/**
 * Parse a `/spec` breakdown. Agents fill the template loosely, so this accepts: "### TICKET-1 — Title" (any dash
 * or colon), bullets like "- **Scope:** …", "- Acceptance criteria:" with sub-bullets, "- Depends on: TICKET-1, TICKET-2".
 */
export function parseSpec(md: string): { title: string; summary: string; tickets: SpecTicket[] } {
  const text = md.replace(/\r\n/g, '\n');
  const title = text.match(/^#\s+(?:Spec:\s*)?(.+)$/m)?.[1]?.trim() ?? 'Spec';
  const summary = text.match(/^##\s+Epic summary[^\n]*\n+([\s\S]*?)(?=\n##\s)/im)?.[1]?.trim() ?? '';
  const tickets: SpecTicket[] = [];
  const re = /^###\s+([A-Za-z]+-\d+)\s*[—–:-]+\s*(.+)$/gm;
  const heads = [...text.matchAll(re)];
  heads.forEach((h, i) => {
    // A ticket runs to the next ticket heading, or for the last one to the next "## " section.
    const nextSection = text.indexOf('\n## ', h.index);
    const end = i + 1 < heads.length ? heads[i + 1]!.index : nextSection >= 0 ? nextSection : text.length;
    const body = text.slice(h.index + h[0].length, end);
    tickets.push({ id: h[1]!.toUpperCase(), title: h[2]!.trim(), ...parseTicketBody(body) });
  });
  return { title, summary, tickets };
}

function parseTicketBody(body: string): Omit<SpecTicket, 'id' | 'title'> {
  const lines = body.split('\n');
  let goal = '';
  let dependsOn: string[] = [];
  let files: string[] = [];
  let issueType: string | undefined;
  const criteria: string[] = [];
  let inCriteria = false;
  for (const raw of lines) {
    const line = raw.replace(/\*\*/g, '');
    const top = line.match(/^[-*]\s+(.*)$/);
    const nested = line.match(/^\s{2,}[-*]\s+(?:\[[ xX]\]\s+)?(.*)$/);
    if (nested && inCriteria) {
      criteria.push(nested[1]!.trim());
      continue;
    }
    if (!top) continue;
    const item = top[1]!.trim();
    inCriteria = false;
    let m: RegExpMatchArray | null;
    if ((m = item.match(/^depends on:?\s*(.*)$/i))) {
      dependsOn = [...m[1]!.matchAll(/[A-Za-z]+-\d+/g)].map((x) => x[0].toUpperCase());
    } else if ((m = item.match(/^(?:scope(?:\s*\/\s*acceptance criteria)?|goal):?\s*(.*)$/i))) {
      goal = m[1]!.trim();
      inCriteria = /acceptance/i.test(item);
    } else if ((m = item.match(/^acceptance criteria:?\s*(.*)$/i))) {
      if (m[1]) criteria.push(m[1].trim());
      inCriteria = true;
    } else if ((m = item.match(/^files touched[^:]*:?\s*(.*)$/i))) {
      files = parseFiles(m[1]!);
    } else if ((m = item.match(/^(?:issue )?type:\s*([A-Za-z][\w-]*(?: [A-Za-z][\w-]*)?)\s*$/i))) {
      // Colon required, so a criterion like "Type checks pass" stays a criterion.
      issueType = m[1]!.trim();
    } else {
      criteria.push(item.replace(/^\[[ xX]\]\s+/, ''));
    }
  }
  return { goal, acceptanceCriteria: criteria, dependsOn, files, ...(issueType ? { issueType } : {}) };
}

/** "`src/a.ts`, src/b/ (+ tests), `cli.ts`" -> paths; words without a dot or slash (e.g. "tests") are dropped. */
function parseFiles(text: string): string[] {
  return text
    .replace(/\([^)]*\)/g, ' ')
    .split(/[,;]|\s+and\s+/)
    .map((f) => f.replace(/[`*]/g, '').trim())
    .filter((f) => f && /[./\\]/.test(f) && !/\s/.test(f));
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
