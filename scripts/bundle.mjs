// Bundle the CLI and the MCP launcher into self-contained ESM files inside the plugin, so an installed plugin
// (copied into Claude Code's plugin cache, without node_modules) can run them with plain `node`.
//   node scripts/bundle.mjs           build
//   node scripts/bundle.mjs --check   exit 1 if the committed bundles are stale (used by the test suite)
import { build } from 'esbuild';
import { existsSync, readFileSync } from 'node:fs';

const check = process.argv.includes('--check');
const pkg = JSON.parse(readFileSync(new URL('../packages/atlassian/package.json', import.meta.url), 'utf8'));

const common = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  legalComments: 'none',
  logLevel: check ? 'silent' : 'info',
  // Some dependencies (turndown's DOM shim) are CommonJS and call require().
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  define: { 'process.env.SDLC_ATL_VERSION': JSON.stringify(pkg.version) },
  write: !check,
};

const targets = [
  { entryPoints: ['packages/atlassian/src/cli.ts'], outfile: 'plugins/sdlc/bin/sdlc-atl.mjs' },
  { entryPoints: ['scripts/mcp-atlassian.mjs'], outfile: 'plugins/sdlc/bin/mcp-atlassian.mjs' },
];

let stale = [];
for (const t of targets) {
  const result = await build({ ...common, ...t });
  if (check) {
    const fresh = result.outputFiles[0].text;
    const committed = existsSync(t.outfile) ? readFileSync(t.outfile, 'utf8') : '';
    if (fresh !== committed.replace(/\r\n/g, '\n')) stale.push(t.outfile);
  }
}
if (stale.length) {
  console.error(`Stale bundle(s): ${stale.join(', ')}. Run: npm run bundle`);
  process.exit(1);
}
