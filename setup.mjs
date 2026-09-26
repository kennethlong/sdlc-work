#!/usr/bin/env node
// Getting started: `node setup.mjs` (see scripts/setup/main.mjs, or `node setup.mjs --help`).
// This file only checks that Node is new enough to run the wizard itself, using syntax any Node understands.
var major = Number(process.versions.node.split('.')[0]);
if (major < 18) {
  console.error('sdlc-work setup needs Node.js 18 or newer to start (and installs/asks for 22+). This is Node ' + process.versions.node + '.');
  console.error(process.platform === 'win32'
    ? 'Install: winget install --id OpenJS.NodeJS.LTS -e   (then open a new terminal)'
    : process.platform === 'darwin' ? 'Install: brew install node' : 'Install: https://nodejs.org/en/download');
  process.exit(1);
}
import('./scripts/setup/main.mjs');
