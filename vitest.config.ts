import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['packages/*/test/**/*.test.ts'], exclude: ['**/*.live.test.ts'] } },
      // Hits the local DC stack (infra/atlassian-dc); run with `npm run test:live`. The guard refuses to run without
      // SDLC_LIVE=1, or against non-local URLs unless SDLC_LIVE_ALLOW_REMOTE=1.
      {
        test: {
          name: 'live',
          include: ['packages/*/test/**/*.live.test.ts'],
          globalSetup: ['packages/atlassian/test/live-guard.ts'],
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
