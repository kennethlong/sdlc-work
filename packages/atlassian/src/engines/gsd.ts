import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { readText } from './text.ts';
import type { Breakdown, Engine, TicketProgress, Verification, WorkItem, WorkStatus } from '../work.ts';

const run = promisify(execFile);

type AnalyzedPhase = { number: string; name: string; goal: string | null; depends_on: string | null; roadmap_complete: boolean; disk_status: string };
type PhaseDetail = { found: boolean; success_criteria?: string[]; section?: string };
type FoundPhase = { found: boolean; directory: string | null };

/**
 * GSD Core adapter. Reads ROADMAP phases through `gsd-tools` (GSD's own parser) instead of parsing markdown here,
 * so it keeps working as GSD's format evolves.
 */
export class GsdEngine implements Engine {
  readonly name = 'gsd' as const;
  private readonly toolsPath?: string;

  constructor(opts: { gsdTools?: string } = {}) {
    this.toolsPath = opts.gsdTools;
  }

  ticketProgress(root: string, key: string) {
    return gsdTicketProgress(root, key);
  }

  nextSteps(key: string, summary: string, isBug: boolean): string[] {
    // The quick task's description starts with the key, so its directory slug contains it (that's the link).
    return [
      ...(isBug ? [`\`/rca ${key}\`: root cause -> \`docs/rca/${key}.md\`, then \`sdlc-atl publish-rca ${key}\``] : []),
      `\`/gsd-quick --validate "${key}: ${isBug ? 'fix ' : ''}${summary.replace(/"/g, "'")}"\`, pointing the planner at \`.sdlc/tickets/${key}.md\``,
      ...(isBug ? ['The fix must add a regression test (and a rule, so the class of bug cannot recur)'] : []),
      '`sdlc-atl sync`: moves the Jira issue and publishes the verification',
    ];
  }

  detect(root: string) {
    return existsSync(join(root, '.planning', 'ROADMAP.md'));
  }

  async loadBreakdown(root: string): Promise<Breakdown> {
    const tools = this.toolsPath ?? findGsdTools(root);
    const analysis = await gsd<{ phases: AnalyzedPhase[] }>(tools, root, ['roadmap', 'analyze']);
    const known = new Set(analysis.phases.map((p) => canonicalPhase(p.number)));
    // Each gsd-tools call is a node process (~0.5s); run the per-phase calls in parallel so a 25-phase
    // roadmap takes seconds, not a minute.
    const items = await mapLimit(analysis.phases, 8, async (p): Promise<WorkItem> => {
      const [detail, found] = await Promise.all([
        gsd<PhaseDetail>(tools, root, ['roadmap', 'get-phase', p.number]),
        p.disk_status === 'no_directory' ? undefined : gsd<FoundPhase>(tools, root, ['find-phase', p.number]),
      ]);
      const verification = found?.directory ? readVerification(root, found.directory) : undefined;
      return {
        id: canonicalPhase(p.number),
        title: p.name,
        goal: p.goal ?? '',
        acceptanceCriteria: detail.success_criteria ?? [],
        requirements: parseRequirements(detail.section ?? ''),
        dependsOn: parseDependsOn(p.depends_on, known),
        status: statusOf(p, verification),
        source: `.planning/ROADMAP.md (Phase ${p.number})`,
        verification,
      };
    });
    const roadmap = readText(join(root, '.planning', 'ROADMAP.md'));
    return {
      engine: 'gsd',
      title: roadmap.match(/^#\s+Roadmap:\s*(.+)$/m)?.[1]?.trim() ?? 'Roadmap',
      overview: roadmap.match(/^##\s+Overview\s*\n+([\s\S]*?)(?=\n##\s)/m)?.[1]?.trim() ?? '',
      items,
    };
  }
}

/**
 * Track B progress for a Jira key from GSD quick tasks: `.planning/quick/<quick_id>-<slug>/`, where the slug comes
 * from the task description, so a task started as "SDLC-5: …" lands in a dir containing "sdlc-5". A task dir also
 * counts when its CONTEXT/PLAN has a "Ticket: SDLC-5" line.
 *   <id>-PLAN.md -> planned; <id>-SUMMARY.md -> executing, or complete when its front matter says
 *   `status: complete` and no verification ran; <id>-VERIFICATION.md -> its verdict wins.
 */
export async function gsdTicketProgress(root: string, key: string): Promise<TicketProgress> {
  const quick = join(root, '.planning', 'quick');
  if (!existsSync(quick)) return { status: 'not_started', artifacts: [] };
  const k = key.toLowerCase();
  const ticketLine = new RegExp(`^\\**ticket\\**:?\\**\\s*${key.replace(/[-]/g, '\\-')}\\b`, 'im');
  const dirs = readdirSync(quick, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => {
      if (new RegExp(`(^|-)${k.replace(/[-]/g, '\\-')}(-|$)`).test(name.toLowerCase())) return true;
      return readdirSync(join(quick, name))
        .filter((f) => /-(CONTEXT|PLAN)\.md$/.test(f))
        .some((f) => ticketLine.test(readText(join(quick, name, f))));
    })
    .sort();
  const dir = dirs.at(-1);
  if (!dir) return { status: 'not_started', artifacts: [] };

  const rel = `.planning/quick/${dir}`;
  const files = readdirSync(join(quick, dir)).sort();
  const artifacts = files.filter((f) => f.endsWith('.md')).map((f) => `${rel}/${f}`);
  const verification = readVerification(root, rel);
  if (verification) return { status: verification.status === 'passed' ? 'complete' : 'needs_attention', verification, artifacts };
  const summary = files.find((f) => f.endsWith('-SUMMARY.md'));
  if (summary) {
    const done = /^status:\s*complete\s*$/m.test(readText(join(quick, dir, summary)).split(/\n---/)[0] ?? '');
    return { status: done ? 'complete' : 'executing', artifacts };
  }
  return { status: files.some((f) => f.endsWith('-PLAN.md')) ? 'planned' : 'discussed', artifacts };
}

/** GSD writes the same phase as "04.3" and "4.3"; use one form for ids and dependencies. */
export function canonicalPhase(n: string): string {
  return n.split('.').map((s) => String(Number(s))).join('.');
}

/**
 * GSD's "Depends on" is free text for humans, e.g.
 *   "Phase 5.4 (live-channel model it extends); lands adjacent to Phase 9 with …"
 *   "**Phase 5.2** — its evidence base …"   "Phase 04.4 / 05.7 (workspace services)"
 * Be conservative: drop parentheticals, stop at the first ";" or dash-clause (commentary), take only numbers that
 * directly follow "Phase(s)", and when `known` is given keep only ids that exist in the roadmap.
 */
export function parseDependsOn(text: string | null, known?: Set<string>): string[] {
  if (!text || /^\s*(nothing|none|-|n\/a)\b/i.test(text)) return [];
  let s = text.replace(/\*\*/g, '');
  for (let prev = ''; prev !== s; ) {
    prev = s;
    s = s.replace(/\([^()]*\)/g, ' ');
  }
  s = s.split(/;|\s[—–]\s|\s-\s/)[0]!;
  const ids: string[] = [];
  const num = String.raw`\d+(?:\.\d+)*`;
  const listRe = new RegExp(String.raw`\bphases?\s+(${num}(?:\s*(?:,|/|&|\band\b|\bor\b|-|–)\s*(?:phases?\s+)?${num})*)`, 'gi');
  for (const m of s.matchAll(listRe)) {
    const list = m[1]!;
    for (const part of list.split(/\s*(?:,|\/|&|\band\b|\bor\b)\s*(?:phases?\s+)?/i)) {
      const range = part.match(new RegExp(String.raw`^(\d+)\s*[-–]\s*(\d+)$`));
      if (range) for (let i = Number(range[1]); i <= Number(range[2]); i++) ids.push(String(i));
      else if (part.trim()) ids.push(canonicalPhase(part.trim()));
    }
  }
  return [...new Set(ids)].filter((id) => !known || known.has(id));
}

export function parseRequirements(section: string): string[] {
  const line = section.match(/\*\*Requirements\*\*:\s*(.+)/)?.[1] ?? '';
  return line
    .replace(/[[\]]/g, '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^[A-Z][A-Z0-9]*-\d+/.test(s));
}

/**
 * GSD disk_status (derived by gsd-tools from the phase dir): empty | discussed | researched | planned | partial
 * (some plans executed) | complete (passing VERIFICATION). A non-passing verification report means the phase
 * was executed and checked but needs attention.
 */
function statusOf(p: AnalyzedPhase, v?: Verification): WorkStatus {
  if (p.disk_status === 'complete' || p.roadmap_complete) return 'complete';
  if (v && v.status !== 'passed') return 'needs_attention';
  switch (p.disk_status) {
    case 'partial':
      return 'executing';
    case 'planned':
      return 'planned';
    case 'discussed':
    case 'researched':
      return 'discussed';
    default:
      return 'not_started';
  }
}

/** Latest `*-VERIFICATION.md` in a phase dir, with its front matter parsed. */
export function readVerification(root: string, phaseDir: string): Verification | undefined {
  const abs = join(root, phaseDir);
  if (!existsSync(abs)) return undefined;
  const file = readdirSync(abs)
    .filter((f) => /(^|-)VERIFICATION\.md$/.test(f))
    .sort()
    .at(-1);
  if (!file) return undefined;
  const text = readText(join(abs, file));
  const fm = text.match(/^---\n([\s\S]*?)\n---\n?/);
  const meta: Record<string, string> = {};
  for (const line of fm?.[1]?.split('\n') ?? []) {
    const m = line.match(/^([A-Za-z_]+):\s*(.*?)\s*$/);
    if (m && m[2]) meta[m[1]!] = m[2].replace(/^["']|["']$/g, '');
  }
  return {
    status: meta.status ?? 'unknown',
    score: meta.score,
    verifiedAt: meta.verified,
    markdown: text.slice(fm?.[0].length ?? 0).trim(),
    path: `${phaseDir}/${file}`.split('\\').join('/'),
  };
}

async function gsd<T>(tools: string, cwd: string, args: string[]): Promise<T> {
  const { stdout } = await run(process.execPath, [tools, ...args, '--cwd', cwd], { cwd, maxBuffer: 32 * 1024 * 1024 });
  return JSON.parse(stdout) as T;
}

/**
 * Locate gsd-tools: $GSD_TOOLS, a project-local install, then global installs for the runtimes GSD supports.
 */
export function findGsdTools(root: string): string {
  const rel = join('gsd-core', 'bin', 'gsd-tools.cjs');
  const candidates = [
    process.env.GSD_TOOLS,
    ...['.claude', '.codex', '.cursor', '.gemini', '.opencode'].flatMap((d) => [join(root, d, rel), join(homedir(), d, rel)]),
  ].filter((c): c is string => !!c);
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error(`gsd-tools not found. Install GSD Core (npx @opengsd/gsd-core) or set GSD_TOOLS. Looked in:\n  ${candidates.join('\n  ')}`);
  return found;
}

/** Promise.all with at most `limit` in flight; preserves input order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
