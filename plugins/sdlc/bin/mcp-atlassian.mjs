#!/usr/bin/env node
import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);

// scripts/mcp-atlassian.mjs
import { spawn } from "node:child_process";

// packages/atlassian/src/config.ts
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
function envLookup(opts = {}) {
  const userFile = join(homedir(), ".sdlc", "atlassian.env");
  const explicit = process.env.SDLC_ATLASSIAN_ENV === "user" ? userFile : process.env.SDLC_ATLASSIAN_ENV;
  const file = opts.envFile ?? explicit ?? findLocalStackEnv(opts.cwd ?? process.cwd()) ?? (existsSync(userFile) ? userFile : void 0);
  const fromFile = file && existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
  return (k) => process.env[k] || fromFile[k] || "";
}
function loadConfig(opts = {}) {
  const get = envLookup(opts);
  const product = (p) => {
    const baseUrl = get(`${p}_BASE_URL`).replace(/\/+$/, "");
    if (!baseUrl) return void 0;
    const flavorVar = get(`${p}_FLAVOR`).toLowerCase();
    const flavor = flavorVar === "cloud" || flavorVar === "dc" ? flavorVar : detectFlavor(baseUrl);
    const pat = get(`${p}_PAT`);
    const user = get(`${p}_EMAIL`) || get("ATLASSIAN_EMAIL");
    const apiToken = get(`${p}_API_TOKEN`) || get("ATLASSIAN_API_TOKEN");
    let auth;
    if (flavor === "dc" && pat) auth = { type: "bearer", token: pat };
    else if (user && apiToken) auth = { type: "basic", user, token: apiToken };
    else if (pat) auth = { type: "bearer", token: pat };
    return auth ? { baseUrl, flavor, auth } : void 0;
  };
  return { jira: product("JIRA"), confluence: product("CONFLUENCE") };
}
function detectFlavor(baseUrl) {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host.endsWith(".atlassian.net") || host.endsWith(".jira.com") ? "cloud" : "dc";
  } catch {
    return "dc";
  }
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
for (const [prefix, p] of [["JIRA", cfg.jira], ["CONFLUENCE", cfg.confluence]]) {
  if (!p) continue;
  env[`${prefix}_URL`] = p.baseUrl;
  if (p.auth.type === "bearer") env[`${prefix}_PERSONAL_TOKEN`] = p.auth.token;
  else Object.assign(env, { [`${prefix}_USERNAME`]: p.auth.user, [`${prefix}_API_TOKEN`]: p.auth.token });
}
var child = spawn("uvx", [`mcp-atlassian@${VERSION}`, ...process.argv.slice(2)], { env, stdio: "inherit", shell: process.platform === "win32" });
child.on("exit", (code, signal) => process.exit(signal ? 1 : code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
