#!/usr/bin/env node
// PreToolUse hook (Claude Code and GitHub Copilot CLI): the gate. Reads the tool call as JSON on stdin, denies it
// when policy.mjs says so, and appends one line per call to .sdlc/audit.jsonl in repos set up for sdlc.
//
// Denial is a JSON decision on stdout (hookSpecificOutput.permissionDecision = "deny"), which both agents read;
// the reason goes back to the agent so it adapts. Fails OPEN: any error in this script allows the call, so a bug
// here can never brick a session. SDLC_GUARD=off turns blocking off (still logged); SDLC_AUDIT=off stops logging.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, renameSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { evaluate, summarize } from './policy.mjs';

const MAX_LOG_BYTES = 10 * 1024 * 1024;

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

function audit(cwd, entry) {
  if (process.env.SDLC_AUDIT === 'off') return;
  const dir = join(cwd, '.sdlc');
  if (!existsSync(dir) && process.env.SDLC_AUDIT !== 'on') return; // only repos that use sdlc (or when asked)
  const file = join(dir, 'audit.jsonl');
  try {
    if (existsSync(file) && statSync(file).size > MAX_LOG_BYTES) renameSync(file, `${file}.1`);
  } catch {}
  appendFileSync(file, JSON.stringify(entry) + '\n');
}

async function main() {
  const raw = await readStdin();
  const event = JSON.parse(raw || '{}');
  const tool = event.tool_name ?? event.toolName ?? '';
  let input = event.tool_input ?? event.toolArgs ?? {};
  if (typeof input === 'string') {
    try {
      input = JSON.parse(input);
    } catch {
      input = { command: input };
    }
  }
  const cwd = process.env.CLAUDE_PROJECT_DIR || process.env.COPILOT_PROJECT_DIR || event.cwd || process.cwd();
  const verdict = evaluate(tool, input, {
    home: homedir(),
    currentBranch: () => execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim(),
  });
  const enforce = process.env.SDLC_GUARD !== 'off';
  try {
    audit(cwd, {
      ts: new Date().toISOString(),
      agent: process.env.COPILOT_PLUGIN_ROOT ? 'copilot' : 'claude',
      session: event.session_id ?? event.sessionId,
      tool,
      input: summarize(tool, input),
      decision: verdict.decision === 'deny' && !enforce ? 'would-deny' : verdict.decision,
      ...(verdict.rule ? { rule: verdict.rule } : {}),
    });
  } catch {}
  if (verdict.decision === 'deny' && enforce) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: verdict.reason } }));
  }
}

main()
  .catch(() => {}) // fail open
  .finally(() => process.exit(0));
