import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Breakdown, Engine, Verification, WorkItem, WorkStatus } from '../work.ts';

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

  detect(root: string) {
    return existsSync(join(root, '.planning', 'ROADMAP.md'));
  }

  async loadBreakdown(root: string): Promise<Breakdown> {
    const tools = this.toolsPath ?? findGsdTools(root);
    const analysis = await gsd<{ phases: AnalyzedPhase[] }>(tools, root, ['roadmap', 'analyze']);
    const items: WorkItem[] = [];
    for (const p of analysis.phases) {
      const detail = await gsd<PhaseDetail>(tools, root, ['roadmap', 'get-phase', p.number]);
      let verification: Verification | undefined;
      if (p.disk_status !== 'no_directory') {
        const dir = (await gsd<FoundPhase>(tools, root, ['find-phase', p.number])).directory;
        if (dir) verification = readVerification(root, dir);
      }
      items.push({
        id: p.number,
        title: p.name,
        goal: p.goal ?? '',
        acceptanceCriteria: detail.success_criteria ?? [],
        requirements: parseRequirements(detail.section ?? ''),
        dependsOn: parseDependsOn(p.depends_on),
        status: statusOf(p, verification),
        source: `.planning/ROADMAP.md (Phase ${p.number})`,
        verification,
      });
    }
    const roadmap = readFileSync(join(root, '.planning', 'ROADMAP.md'), 'utf8');
    return {
      engine: 'gsd',
      title: roadmap.match(/^#\s+Roadmap:\s*(.+)$/m)?.[1]?.trim() ?? 'Roadmap',
      overview: roadmap.match(/^##\s+Overview\s*\n+([\s\S]*?)(?=\n##\s)/m)?.[1]?.trim() ?? '',
      items,
    };
  }
}

/** "Phase 1", "Phases 1 and 2.1", "Phase 1, Phase 3", "Nothing (first phase)" -> ids. */
export function parseDependsOn(text: string | null): string[] {
  if (!text || /^\s*(nothing|none|-|n\/a)/i.test(text)) return [];
  // Normalise "02.1" -> "2.1" to match the phase numbers gsd-tools reports.
  return [...text.matchAll(/\d+(?:\.\d+)*/g)].map((m) => m[0].split('.').map((n) => String(Number(n))).join('.'));
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
  const text = readFileSync(join(abs, file), 'utf8').replace(/\r\n/g, '\n');
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
