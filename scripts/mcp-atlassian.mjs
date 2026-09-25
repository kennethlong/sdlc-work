#!/usr/bin/env node
// Launch the mcp-atlassian MCP server (stdio) against Jira/Confluence Data Center using PATs.
// Settings come from the environment, else the nearest infra/atlassian-dc/.env (local stack), else
// ~/.sdlc/atlassian.env, via @sdlc/atlassian's loadConfig: JIRA_BASE_URL, JIRA_PAT, CONFLUENCE_BASE_URL, CONFLUENCE_PAT.
// Defaults to mcp-atlassian's "default" toolset (~35 tools instead of ~98); set TOOLSETS=all to widen.
// Extra args are passed through (e.g. --read-only).
import { spawn } from 'node:child_process';
import { loadConfig } from '../packages/atlassian/src/config.ts';

const VERSION = process.env.MCP_ATLASSIAN_VERSION ?? '0.23.1';

// MCP clients start servers in the project directory; resolve config from there.
const cfg = loadConfig({ cwd: process.cwd() });
if (!cfg.jira && !cfg.confluence) {
  console.error('mcp-atlassian: no Jira/Confluence configured (JIRA_BASE_URL/JIRA_PAT, CONFLUENCE_BASE_URL/CONFLUENCE_PAT, or ~/.sdlc/atlassian.env).');
  process.exit(1);
}

const env = { TOOLSETS: 'default', ...process.env };
// mcp-atlassian: DC uses <P>_PERSONAL_TOKEN; Cloud uses <P>_USERNAME (email) + <P>_API_TOKEN.
for (const [prefix, p] of [['JIRA', cfg.jira], ['CONFLUENCE', cfg.confluence]]) {
  if (!p) continue;
  env[`${prefix}_URL`] = p.baseUrl;
  if (p.auth.type === 'bearer') env[`${prefix}_PERSONAL_TOKEN`] = p.auth.token;
  else Object.assign(env, { [`${prefix}_USERNAME`]: p.auth.user, [`${prefix}_API_TOKEN`]: p.auth.token });
}

const child = spawn('uvx', [`mcp-atlassian@${VERSION}`, ...process.argv.slice(2)], { env, stdio: 'inherit', shell: process.platform === 'win32' });
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
