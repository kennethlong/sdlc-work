// Pure helpers for the getting-started wizard (no I/O beyond what callers pass in), so they can be unit-tested.
// Plain JavaScript that runs on old Node versions too: the wizard must start even where it has to install Node 22+.

/** Minimum Node for the bundled CLI and MCP launcher (esbuild target node22). */
export const MIN_NODE = 22;

export const MCP_NAME = 'sdlc-atlassian';

/** AI tools the wizard can set up. `detect` is a command that exits 0 when the tool is installed. */
export const AGENTS = [
  { id: 'copilot', name: 'GitHub Copilot CLI', detect: ['copilot', '--version'], skills: true },
  { id: 'vscode', name: 'GitHub Copilot in VS Code', detect: ['code', '--version'], skills: true },
  { id: 'codex', name: 'OpenAI Codex CLI', detect: ['codex', '--version'], skills: true },
  { id: 'claude', name: 'Claude Code', detect: ['claude', '--version'], skills: false }, // gets the plugin instead
];

/**
 * Prerequisites. `install` per platform: winget (Windows), brew (macOS); elsewhere the wizard prints `manual`.
 * `required` ones block setup; `for` says what needs them.
 */
export const PREREQS = [
  {
    id: 'node', name: 'Node.js 22+', required: true, for: 'the sdlc-atl CLI and MCP server',
    install: { win32: 'winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements', darwin: 'brew install node' },
    manual: 'https://nodejs.org/en/download (LTS)',
  },
  {
    id: 'git', name: 'git', required: true, check: ['git', '--version'], for: 'branches, hooks and PRs',
    install: { win32: 'winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements', darwin: 'brew install git' },
    manual: 'https://git-scm.com/downloads',
  },
  {
    id: 'uv', name: 'uv (uvx)', required: true, check: ['uvx', '--version'], for: 'the Jira/Confluence MCP server (mcp-atlassian runs via uvx)',
    install: { win32: 'winget install --id astral-sh.uv -e --accept-source-agreements --accept-package-agreements', darwin: 'brew install uv' },
    manual: 'curl -LsSf https://astral.sh/uv/install.sh | sh   (or: pipx install uv)',
  },
  {
    id: 'gh', name: 'GitHub CLI (gh)', required: false, check: ['gh', '--version'], for: 'GitHub pull requests (not needed for Bitbucket)',
    install: { win32: 'winget install --id GitHub.cli -e --accept-source-agreements --accept-package-agreements', darwin: 'brew install gh' },
    manual: 'https://cli.github.com',
  },
];

export function nodeMajor(version = process.versions.node) {
  return Number(String(version).replace(/^v/, '').split('.')[0]);
}

// ---- ~/.sdlc/atlassian.env ------------------------------------------------------------------------------------

/** Parse KEY=VALUE lines (comments and blank lines ignored; optional quotes stripped). */
export function parseEnv(text) {
  const out = {};
  for (const line of String(text).replace(/^﻿/, '').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

/**
 * Update KEY=VALUE lines in place, keeping comments, order and unrelated keys; new keys are appended.
 * A value of `undefined` removes the key.
 */
export function mergeEnv(text, updates) {
  const lines = String(text ?? '').replace(/^﻿/, '').split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const seen = new Set();
  const out = [];
  for (const line of lines) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m && m[1] in updates) {
      seen.add(m[1]);
      if (updates[m[1]] !== undefined) out.push(`${m[1]}=${updates[m[1]]}`);
      continue;
    }
    out.push(line);
  }
  for (const [k, v] of Object.entries(updates)) if (!seen.has(k) && v !== undefined) out.push(`${k}=${v}`);
  return out.join('\n') + '\n';
}

/** "abcd…wxyz" style masking for showing a secret that is already set. */
export function mask(secret) {
  const s = String(secret ?? '');
  if (!s) return '(not set)';
  return s.length <= 8 ? '•'.repeat(s.length) : `${s.slice(0, 4)}…${s.slice(-4)} (${s.length} chars)`;
}

export function isCloud(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.endsWith('.atlassian.net') || host.endsWith('.jira.com');
  } catch {
    return false;
  }
}

/** Normalise a pasted base URL: add https://, drop trailing slashes and common page paths. */
export function normaliseUrl(input, product) {
  let u = String(input ?? '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  const url = new URL(u);
  let path = url.pathname.replace(/\/+$/, '');
  path = path.replace(/\/(secure\/.*|browse\/.*|projects\/.*|dashboards.*|spaces\/.*|display\/.*|pages\/.*|login.*)$/i, '');
  if (product === 'confluence' && isCloud(url.href) && !/\/wiki$/.test(path)) path = `${path}/wiki`;
  return `${url.protocol}//${url.host}${path}`;
}

/** Where a user creates the token each product needs. */
export function tokenHelp(product, baseUrl) {
  const cloud = isCloud(baseUrl);
  if (cloud) return 'Create an API token at https://id.atlassian.com/manage-profile/security/api-tokens (same token for Jira and Confluence Cloud).';
  if (product === 'jira') return `Create a Personal Access Token: ${baseUrl}/secure/ViewProfile.jspa?selectedTab=com.atlassian.pats.pats-plugin:jira-user-personal-access-tokens`;
  if (product === 'confluence') return `Create a Personal Access Token: ${baseUrl}/plugins/personalaccesstokens/usertokens.action`;
  return `Create an HTTP access token: ${baseUrl} -> your avatar -> Manage account -> HTTP access tokens (permissions: project/repository write).`;
}

/** The request that proves a credential works, per product and flavor. */
export function probe(product, baseUrl) {
  if (product === 'jira') return `${baseUrl}/rest/api/2/myself`;
  if (product === 'confluence') return `${baseUrl}/rest/api/user/current`;
  return `${baseUrl}/rest/api/1.0/projects?limit=1`; // works for user, project and repository tokens
}

/** Explain a failed fetch (no HTTP response) in terms a developer can act on. */
export function networkReason(err) {
  const code = err?.cause?.code ?? err?.code ?? '';
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return { kind: 'timeout', text: 'no response (VPN or proxy?)' };
  if (/CERT|SELF_SIGNED|UNABLE_TO_(GET|VERIFY)/.test(code))
    return { kind: 'tls', text: `the server's TLS certificate is not trusted by Node (${code}); usually a company proxy that inspects TLS` };
  if (code === 'ENOTFOUND') return { kind: 'dns', text: 'host not found (check the URL; VPN connected?)' };
  if (code === 'ECONNREFUSED') return { kind: 'refused', text: 'connection refused (wrong port, or the server is down)' };
  return { kind: 'other', text: `${err?.cause?.message ?? err?.message ?? String(err)}${code ? ` (${code})` : ''}` };
}

// ---- skills for agents other than Claude Code -----------------------------------------------------------------

/**
 * Turn a plugin skill into a standalone Agent Skill for Copilot, Codex and others:
 *   - name `sdlc-<name>` (the plugin namespaces as `/sdlc:<name>`), and `/sdlc:x` references become `/sdlc-x`;
 *   - the plugin-relative CLI path becomes plain `sdlc-atl` (installed on PATH);
 *   - `$1`, `$2`, `$ARGUMENTS` (only Claude Code substitutes them) become named placeholders from the skill's
 *     `argument-hint`, with a note saying they stand for what the user passed.
 */
/** For files that sit beside a SKILL.md (templates): CLI on PATH and `sdlc-<name>` skill names. */
export function portText(text) {
  return String(text)
    .split('node "${CLAUDE_PLUGIN_ROOT}/bin/sdlc-atl.mjs"').join('sdlc-atl')
    .split('${CLAUDE_PLUGIN_ROOT}/bin/sdlc-atl.mjs').join('sdlc-atl')
    .replace(/\/sdlc:([a-z-]+)/g, '/sdlc-$1');
}

export function portSkill(text, name) {
  let t = String(text).replace(/\r\n/g, '\n');
  const hint = t.match(/^argument-hint:\s*["']?(.*?)["']?\s*$/m)?.[1] ?? '';
  const single = hint.match(/^[<[]([^\]>]+)[\]>]$/)?.[1];
  const argName = single ? `<${single}>` : '<arguments>';
  t = t.replace(/^name:\s*\S+/m, `name: sdlc-${name}`);
  t = t.split('node "${CLAUDE_PLUGIN_ROOT}/bin/sdlc-atl.mjs"').join('sdlc-atl');
  t = t.replace(/^CLI: `sdlc-atl` \(or `sdlc-atl` on PATH in other agents\), written `sdlc-atl` below\.$/m, 'CLI: `sdlc-atl` (on PATH).');
  t = t.replace(/\/sdlc:([a-z-]+)/g, '/sdlc-$1');
  const usesArgs = /\$(ARGUMENTS|\d)\b/.test(t);
  t = t.replace(/\$ARGUMENTS\b/g, argName).replace(/\$1\b/g, single ? argName : '<arg 1>').replace(/\$(\d)\b/g, '<arg $1>');
  if (usesArgs) {
    t = t.replace(/^(---\n[\s\S]*?\n---\n)/, `$1\n_Placeholders like \`${argName}\` stand for what the user gave when asking for this skill (e.g. a Jira key)._\n`);
  }
  return t;
}
