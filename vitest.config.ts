import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['packages/*/test/**/*.test.ts'], exclude: ['**/*.live.test.ts'] } },
      // Hits the local DC stack (infra/atlassian-dc); run with `npm run test:live`.
      { test: { name: 'live', include: ['packages/*/test/**/*.live.test.ts'], testTimeout: 60_000, hookTimeout: 120_000 } },
    ],
  },
});
