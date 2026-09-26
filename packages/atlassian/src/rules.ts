/**
 * One rules file for every agent. Copilot, Codex, Cursor and Gemini read AGENTS.md; Claude Code reads CLAUDE.md,
 * which can import it (`@AGENTS.md`). So project rules live in AGENTS.md and CLAUDE.md only imports it (plus any
 * Claude-only notes). Deviation: the reference keeps its rules in CLAUDE.md (Claude Code only).
 *
 * Never overwrites: creates what is missing, appends the import to an existing CLAUDE.md, and only advises when
 * rules already live in CLAUDE.md (moving them is a judgement call for the team).
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const IMPORT_LINE = '@AGENTS.md';

const AGENTS_STUB = `# Agent instructions

Project rules for every AI coding agent (GitHub Copilot, Codex, Claude Code, ...). Claude Code reads them through
CLAUDE.md, which imports this file. Keep them short and specific; the sdlc skills add rules here when a bug or
review shows a pattern agents keep getting wrong.

## Commands

- Build: <command>
- Test: <command>
- Lint / type-check: <command>

## Conventions

- <the patterns this codebase follows, with a file:line example each>
`;

const CLAUDE_STUB = `${IMPORT_LINE}

<!-- Project rules live in AGENTS.md (shared with Copilot, Codex and other agents). Put Claude-only notes below. -->
`;

export type RulesAction = { file: 'AGENTS.md' | 'CLAUDE.md'; action: 'created' | 'import-added' | 'ok' | 'advice'; note?: string };

const importsAgents = (text: string) => /^\s*@AGENTS\.md\s*$/m.test(text);

export function ensureRulesFiles(root: string, opts: { dryRun?: boolean } = {}): RulesAction[] {
  const agents = join(root, 'AGENTS.md');
  const claude = join(root, 'CLAUDE.md');
  const out: RulesAction[] = [];
  const claudeText = existsSync(claude) ? readFileSync(claude, 'utf8') : undefined;
  const claudeHasRules = claudeText !== undefined && claudeText.replace(/@AGENTS\.md|<!--[\s\S]*?-->/g, '').trim().length > 0;

  if (existsSync(agents)) out.push({ file: 'AGENTS.md', action: 'ok' });
  else if (claudeHasRules)
    out.push({ file: 'AGENTS.md', action: 'advice', note: 'Rules live in CLAUDE.md: move the ones every agent needs into AGENTS.md, keep Claude-only notes in CLAUDE.md, and add the line "@AGENTS.md" to CLAUDE.md.' });
  else {
    if (!opts.dryRun) writeFileSync(agents, AGENTS_STUB);
    out.push({ file: 'AGENTS.md', action: 'created', note: 'fill in the commands and conventions (or run /sdlc:create-rules when it exists)' });
  }

  const agentsExists = opts.dryRun ? out[0]!.action !== 'advice' : existsSync(agents);
  if (claudeText === undefined) {
    if (agentsExists) {
      if (!opts.dryRun) writeFileSync(claude, CLAUDE_STUB);
      out.push({ file: 'CLAUDE.md', action: 'created', note: `imports AGENTS.md` });
    }
  } else if (importsAgents(claudeText)) out.push({ file: 'CLAUDE.md', action: 'ok' });
  else if (agentsExists) {
    if (!opts.dryRun) appendFileSync(claude, `${claudeText.endsWith('\n') ? '' : '\n'}\n${IMPORT_LINE}\n`);
    out.push({ file: 'CLAUDE.md', action: 'import-added' });
  }
  return out;
}
