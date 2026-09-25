import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Engine, EngineName } from '../work.ts';
import { GsdEngine } from './gsd.ts';

export { GsdEngine, findGsdTools, parseDependsOn, parseRequirements } from './gsd.ts';

const engines: Record<EngineName, () => Engine> = {
  gsd: () => new GsdEngine(),
  piv: () => {
    throw new Error("The 'piv' engine (reference-style skills) is planned but not built yet; use --engine gsd.");
  },
};

/** Resolve the engine: explicit name, then `.sdlc/config.json` "engine", then auto-detect. */
export function resolveEngine(root: string, name?: string): Engine {
  const configured = name ?? readSdlcConfig(root).engine;
  if (configured) {
    if (!(configured in engines)) throw new Error(`Unknown engine '${configured}' (expected: ${Object.keys(engines).join(', ')})`);
    return engines[configured as EngineName]();
  }
  const gsd = new GsdEngine();
  if (gsd.detect(root)) return gsd;
  throw new Error(`No planning artifacts found in ${root} (expected .planning/ROADMAP.md for GSD). Pass --engine.`);
}

export type SdlcConfig = { engine?: string; epic?: string; prdPageId?: string };

export function readSdlcConfig(root: string): SdlcConfig {
  const file = join(root, '.sdlc', 'config.json');
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as SdlcConfig) : {};
}
