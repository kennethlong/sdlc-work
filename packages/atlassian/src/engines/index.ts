import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Engine, EngineName, WorkStatus } from '../work.ts';
import { findGsdTools, GsdEngine } from './gsd.ts';
import { PivEngine } from './piv.ts';

export { GsdEngine, findGsdTools, parseDependsOn, parseRequirements, readVerification } from './gsd.ts';
export { PivEngine, parseSpec, executionVerdict, type SpecTicket } from './piv.ts';

/** `.sdlc/config.json`. */
export type SdlcConfig = {
  engine?: string;
  epic?: string;
  prdPageId?: string;
  /** piv engine: which docs/specs/*.md to use when there are several. */
  spec?: string;
  /** transitions: work status -> Jira status; `review` (optional) is applied when a PR is opened. */
  /** projects: Jira project keys this repo uses; tells real keys in branch names from look-alikes like UTF-8. */
  /** hold: statuses sync never moves an issue out of, except to Done (e.g. QA). */
  jira?: { issueType?: string; projects?: string[]; hold?: string[]; transitions?: Partial<Record<WorkStatus | 'review', string>>; doneWhen?: 'verified' | 'merged' };
  confluence?: { space?: string };
  git?: { base?: string };
};

export function readSdlcConfig(root: string): SdlcConfig {
  const file = join(root, '.sdlc', 'config.json');
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as SdlcConfig) : {};
}

const factories: Record<EngineName, (cfg: SdlcConfig) => Engine> = {
  gsd: () => new GsdEngine(),
  piv: (cfg) => new PivEngine({ spec: cfg.spec }),
};

/**
 * Resolve the engine: explicit name, then `.sdlc/config.json` "engine", then auto-detect (GSD first). With
 * `fallback`, a repo without planning artifacts (typical for Track B) gets GSD when it's installed, else piv.
 */
export function resolveEngine(root: string, name?: string, opts: { fallback?: boolean } = {}): Engine {
  if (opts.fallback) {
    try {
      return resolveEngine(root, name);
    } catch (e) {
      if (name || readSdlcConfig(root).engine) throw e;
      try {
        findGsdTools(root);
        return new GsdEngine();
      } catch {
        return new PivEngine();
      }
    }
  }
  const cfg = readSdlcConfig(root);
  const configured = name ?? cfg.engine;
  if (configured) {
    if (!(configured in factories)) throw new Error(`Unknown engine '${configured}' (expected: ${Object.keys(factories).join(', ')})`);
    return factories[configured as EngineName](cfg);
  }
  for (const f of Object.values(factories)) {
    const engine = f(cfg);
    if (engine.detect(root)) return engine;
  }
  throw new Error(`No planning artifacts in ${root}: expected .planning/ROADMAP.md (gsd) or docs/specs/*.md (piv). Pass --engine.`);
}
