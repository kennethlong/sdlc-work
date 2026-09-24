#!/usr/bin/env node
// Launch the mcp-atlassian MCP server (stdio) against Jira/Confluence Data Center using PATs.
// Settings come from the environment, or else from infra/atlassian-dc/.env (the local stack), via the
// same rules as @sdlc/atlassian's loadConfig: JIRA_BASE_URL, JIRA_PAT, CONFLUENCE_BASE_URL, CONFLUENCE_PAT.
// Extra args are passed through (e.g. --read-only).
import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../packages/atlassian/src/config.ts';

const VERSION = process.env.MCP_ATLASSIAN_VERSION ?? '0.23.1';

const cfg = loadConfig({ cwd: dirname(fileURLToPath(import.meta.url)) });
if (!cfg.jira && !cfg.confluence) {
  console.error('mcp-atlassian: no Jira/Confluence configured (JIRA_BASE_URL/JIRA_PAT, CONFLUENCE_BASE_URL/CONFLUENCE_PAT).');
  process.exit(1);
}

const env = { ...process.env };
if (cfg.jira) Object.assign(env, { JIRA_URL: cfg.jira.baseUrl, JIRA_PERSONAL_TOKEN: cfg.jira.token });
if (cfg.confluence) Object.assign(env, { CONFLUENCE_URL: cfg.confluence.baseUrl, CONFLUENCE_PERSONAL_TOKEN: cfg.confluence.token });

const child = spawn('uvx', [`mcp-atlassian@${VERSION}`, ...process.argv.slice(2)], { env, stdio: 'inherit', shell: process.platform === 'win32' });
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
