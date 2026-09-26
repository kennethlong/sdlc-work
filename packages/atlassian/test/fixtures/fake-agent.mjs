// Stand-in for an AI agent in headless tests: in each phase it leaves behind what a successful sdlc run would.
// Usage: node fake-agent.mjs KEY MODE PHASE PROMPT_FILE   (MODE: pass | fail | ask; PHASE: plan | execute | report)
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const [key, mode = 'pass', phase = process.env.SDLC_WORK_PHASE, promptFile] = process.argv.slice(2);
// Like a real agent, take the file names from the instructions.
const prompt = promptFile ? readFileSync(promptFile, 'utf8') : '';
const planPath = prompt.match(/\.claude\/plans\/[\w.-]+\.md/)?.[0] ?? `.claude/plans/${key.toLowerCase()}-work.md`;
const slug = planPath.replace(/^.*\//, '').replace(/\.md$/, '');
const put = (rel, text) => {
  mkdirSync(dirname(rel), { recursive: true });
  writeFileSync(rel, text);
};
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' });

if (phase === 'plan') {
  if (mode === 'ask') put(`.sdlc/work/${key}-questions.md`, '1. Which reports need the button? (I would assume all of them.)\n');
  else put(planPath, `# Plan: export button\n\nTicket: ${key}\n`);
} else if (phase === 'execute') {
  put('export-button.ts', `export const exportButton = '${key}';\n`);
  git('add', 'export-button.ts');
  git('commit', '-qm', `feat(${key}): export button`);
} else if (phase === 'report') {
  put(
    prompt.match(/\.claude\/execution-reports\/[\w.-]+\.md/)?.[0] ?? `.claude/execution-reports/${slug}.md`,
    `# Execution Report: export button\n\nTicket: ${key}\n\n## Validation Results\n\n- Unit tests: ${mode === 'pass' ? '✓ 4 passed' : '✗ 1 failed'}\n- Lint: ✓\n`,
  );
}
console.log(`${key} ${phase}: done`);
