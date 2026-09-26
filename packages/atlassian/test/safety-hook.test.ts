import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error plain JS module shipped with the plugin (runs without a build step)
import { evaluate, isBroadTarget, isSecretPath, redact } from '../../../plugins/sdlc/hooks/policy.mjs';

const HOME = 'C:/Users/dev';
const ctx = { home: HOME, currentBranch: () => 'feature/x' };
const shell = (command: string, tool = 'Bash', c = ctx) => evaluate(tool, { command }, c);

describe('safety hook: secrets', () => {
  it.each(['.env', '.env.local', 'config/.env.production', 'C:\\Users\\dev\\.sdlc\\atlassian.env', 'prod.env', 'certs/server.pem', 'tls.key', '~/.ssh/id_rsa', '~/.ssh/id_ed25519', '.netrc', '.git-credentials', '~/.aws/credentials', 'credentials.json', 'secrets.yaml'])(
    'blocks reading %s',
    (p) => {
      expect(isSecretPath(p)).toBe(true);
      expect(evaluate('Read', { file_path: p }).decision).toBe('deny');
      expect(evaluate('view', { path: p }).decision).toBe('deny'); // Copilot CLI's name for Read
    },
  );

  it.each(['.env.example', 'infra/.env.sample', 'atlassian.env.template', '~/.ssh/id_rsa.pub', 'src/env.ts', 'docs/environment.md', 'package.json', '.envrc.md'])('allows %s', (p) => {
    expect(isSecretPath(p)).toBe(false);
    expect(evaluate('Read', { file_path: p }).decision).toBe('allow');
  });

  it.each([
    'cat .env',
    'type infra\\atlassian-dc\\.env',
    'Get-Content $HOME/.sdlc/atlassian.env',
    'grep TOKEN .env.local',
    'cp .env.example .env',
    'printenv',
    'env | sort',
    'set',
    'echo $JIRA_PAT',
    'Write-Output $env:GITHUB_TOKEN',
    'echo %API_KEY%',
    'Get-ChildItem env:',
    'node -e "console.log(process.env)"',
  ])('blocks the shell command: %s', (c) => {
    expect(shell(c).decision).toBe('deny');
    expect(shell(c, 'powershell').decision).toBe('deny');
  });

  it('blocks searching env files, allows searching code', () => {
    expect(evaluate('Grep', { pattern: 'JIRA', path: '.env' }).decision).toBe('deny');
    expect(evaluate('Grep', { pattern: 'PAT', glob: '*.env' }).decision).toBe('deny');
    expect(evaluate('Glob', { pattern: '**/.env*' }).decision).toBe('deny');
    expect(evaluate('Grep', { pattern: 'loadConfig', path: 'packages/atlassian/src' }).decision).toBe('allow');
    expect(evaluate('Glob', { pattern: '**/*.env.example' }).decision).toBe('allow');
  });
});

describe('safety hook: destructive commands', () => {
  it.each([
    'rm -rf /',
    'rm -rf ~',
    'rm -rf ~/',
    'rm -fr $HOME',
    'rm -r -f *',
    'rm -rf .',
    'rm -rf ..',
    'rm -rf ../other-repo',
    'rm -rf /c/Users',
    'rm --recursive --force /etc',
    'sudo rm -rf /var',
    'rm -rf C:/Users/dev',
    'rm -rf C:/Users/dev/projects',
    'rm --no-preserve-root -rf /',
    'Remove-Item -Recurse -Force C:\\',
    'Remove-Item -Path $env:USERPROFILE -Recurse -Force',
    'rd /s /q C:\\Windows',
    'git reset --hard',
    'git reset --hard origin/main',
    'git clean -fdx',
    'git checkout -- .',
    'git restore .',
    'git push --force origin main',
    'git push -f origin master',
    'git push origin +main',
    'git push origin --delete main',
    'git push origin :master',
    'git push --force-with-lease origin HEAD:main',
    'psql -c "DROP DATABASE jira"',
    'format C: /q',
    'mkfs.ext4 /dev/sdb1',
    'dd if=/dev/zero of=/dev/sda bs=1M',
    'npm test && rm -rf ~',
  ])('blocks: %s', (c) => {
    expect(shell(c).decision, c).toBe('deny');
  });

  it('blocks a force push from main even without naming the branch', () => {
    expect(shell('git push --force', 'Bash', { home: HOME, currentBranch: () => 'main' }).decision).toBe('deny');
    expect(shell('git push --force', 'Bash', { home: HOME, currentBranch: () => 'feature/SDLC-9-x' }).decision).toBe('allow');
  });

  it.each([
    'rm -rf node_modules',
    'rm -rf dist build coverage',
    'rm -rf ./packages/atlassian/dist',
    'rm -rf /tmp/sdlc-test-123/repo',
    'rm -rf C:/Users/dev/AppData/Local/Temp/sdlc-x',
    'rm -rf ~/.cache/sdlc/old',
    'rm file.txt',
    'Remove-Item -Recurse -Force .\\node_modules',
    'Remove-Item build.log',
    'git push origin feature/SDLC-9-csv',
    'git push -u origin HEAD',
    'git push --force origin feature/x',
    'git reset --soft HEAD~1',
    'git reset HEAD file.ts',
    'git clean -n',
    'git checkout main',
    'git restore src/a.ts',
    'npm run test:live',
    'curl -H "Authorization: Bearer $JIRA_PAT" https://jira/rest/api/2/myself',
    'node scripts/test-live.mjs',
    'echo done',
    'psql -c "SELECT 1"',
    'docker compose ps',
    'git log --format=%h',
  ])('allows: %s', (c) => {
    expect(shell(c).decision, c).toBe('allow');
  });

  it('knows broad targets from project paths', () => {
    expect(isBroadTarget('/', HOME)).toBe(true);
    expect(isBroadTarget('C:\\', HOME)).toBe(true);
    expect(isBroadTarget('/c/', HOME)).toBe(true);
    expect(isBroadTarget('node_modules', HOME)).toBe(false);
    expect(isBroadTarget('/tmp/a/b', HOME)).toBe(false);
  });

  it('leaves other tools alone', () => {
    expect(evaluate('WebFetch', { url: 'https://example.com/.env' }).decision).toBe('allow');
    expect(evaluate('Edit', { file_path: 'src/a.ts', old_string: 'rm -rf /', new_string: '' }).decision).toBe('allow');
  });
});

describe('safety hook: audit redaction', () => {
  it('never logs token values', () => {
    const r = redact('curl -H "Authorization: Bearer abcdefghijklmnop1234" -u me:ATATT3xFfGF0abcdefghijk https://x?token=s3cr3tvalue123');
    expect(r).not.toMatch(/abcdefghijklmnop1234|ATATT3xFfGF0abcdefghijk|s3cr3tvalue123/);
    expect(r).toContain('[REDACTED]');
  });
});

describe('safety hook: the script', () => {
  const script = fileURLToPath(new URL('../../../plugins/sdlc/hooks/pre-tool-use.mjs', import.meta.url));
  const run = (event: unknown, cwd: string, env: Record<string, string> = {}) =>
    spawnSync(process.execPath, [script], { input: typeof event === 'string' ? event : JSON.stringify(event), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, ...env } });

  it('denies with a JSON decision (Claude Code format; Copilot CLI reads it too) and exits 0', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'sdlc-hook-'));
    const r = run({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'cat .env' } }, cwd);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).hookSpecificOutput).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'deny' });
  });

  it('allows silently, and fails open on garbage input', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'sdlc-hook-'));
    expect(run({ tool_name: 'Bash', tool_input: { command: 'npm test' } }, cwd)).toMatchObject({ status: 0, stdout: '' });
    expect(run('not json{', cwd)).toMatchObject({ status: 0, stdout: '' });
  });

  it('accepts Copilot CLI native input (toolName + JSON-string toolArgs)', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'sdlc-hook-'));
    const r = run({ toolName: 'powershell', toolArgs: JSON.stringify({ command: 'Remove-Item -Recurse -Force C:\\' }) }, cwd);
    expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('audits to .sdlc/audit.jsonl only in sdlc repos, without secrets; SDLC_GUARD=off only logs', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'sdlc-hook-'));
    run({ tool_name: 'Bash', tool_input: { command: 'echo hi' } }, cwd);
    expect(() => readFileSync(join(cwd, '.sdlc', 'audit.jsonl'))).toThrow(); // no .sdlc/: no log
    mkdirSync(join(cwd, '.sdlc'));
    run({ tool_name: 'Bash', session_id: 's1', tool_input: { command: 'curl -H "Authorization: Bearer abcdefghijklmnop1234" x' } }, cwd);
    const off = run({ tool_name: 'Read', tool_input: { file_path: '.env' } }, cwd, { SDLC_GUARD: 'off' });
    expect(off.stdout).toBe('');
    const lines = readFileSync(join(cwd, '.sdlc', 'audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ tool: 'Bash', session: 's1', decision: 'allow', agent: 'claude' });
    expect(JSON.stringify(lines[0])).not.toContain('abcdefghijklmnop1234');
    expect(lines[1]).toMatchObject({ tool: 'Read', decision: 'would-deny', rule: 'secret-file' });
  });
});
