#!/usr/bin/env node
import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);

// scripts/mcp-atlassian.mjs
import { spawn } from "node:child_process";

// packages/atlassian/src/config.ts
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
function loadConfig(opts = {}) {
  const userFile = join(homedir(), ".sdlc", "atlassian.env");
  const file = opts.envFile ?? process.env.SDLC_ATLASSIAN_ENV ?? findLocalStackEnv(opts.cwd ?? process.cwd()) ?? (existsSync(userFile) ? userFile : void 0);
  const fromFile = file && existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
  const get = (k) => process.env[k] || fromFile[k] || "";
  const product = (prefix) => {
    const baseUrl = get(`${prefix}_BASE_URL`);
    const token = get(`${prefix}_PAT`);
    return baseUrl && token ? { baseUrl, token } : void 0;
  };
  return { jira: product("JIRA"), confluence: product("CONFLUENCE") };
}
function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}
function findLocalStackEnv(start) {
  for (let dir = resolve(start); ; dir = dirname(dir)) {
    const candidate = join(dir, "infra", "atlassian-dc", ".env");
    if (existsSync(candidate)) return candidate;
    if (dirname(dir) === dir) return void 0;
  }
}

// scripts/mcp-atlassian.mjs
var VERSION = process.env.MCP_ATLASSIAN_VERSION ?? "0.23.1";
var cfg = loadConfig({ cwd: process.cwd() });
if (!cfg.jira && !cfg.confluence) {
  console.error("mcp-atlassian: no Jira/Confluence configured (JIRA_BASE_URL/JIRA_PAT, CONFLUENCE_BASE_URL/CONFLUENCE_PAT, or ~/.sdlc/atlassian.env).");
  process.exit(1);
}
var env = { TOOLSETS: "default", ...process.env };
if (cfg.jira) Object.assign(env, { JIRA_URL: cfg.jira.baseUrl, JIRA_PERSONAL_TOKEN: cfg.jira.token });
if (cfg.confluence) Object.assign(env, { CONFLUENCE_URL: cfg.confluence.baseUrl, CONFLUENCE_PERSONAL_TOKEN: cfg.confluence.token });
var child = spawn("uvx", [`mcp-atlassian@${VERSION}`, ...process.argv.slice(2)], { env, stdio: "inherit", shell: process.platform === "win32" });
child.on("exit", (code, signal) => process.exit(signal ? 1 : code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
