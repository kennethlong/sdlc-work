import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Breakdown, Engine, WorkItem, WorkStatus } from '../work.ts';

const run = promisify(execFile);

type AnalyzedPhase = { number: string; name: string; goal: string | null; depends_on: string | null; roadmap_complete: boolean; disk_status: string };
type PhaseDetail = { found: boolean; success_criteria?: string[]; section?: string };

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
      items.push({
        id: p.number,
        title: p.name,
        goal: p.goal ?? '',
        acceptanceCriteria: detail.success_criteria ?? [],
        requirements: parseRequirements(detail.section ?? ''),
        dependsOn: parseDependsOn(p.depends_on),
        status: statusOf(p),
        source: `.planning/ROADMAP.md (Phase ${p.number})`,
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

function statusOf(p: AnalyzedPhase): WorkStatus {
  if (p.roadmap_complete) return 'complete';
  if (p.disk_status && !['no_directory', 'empty'].includes(p.disk_status)) return 'in_progress';
  return 'not_started';
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
