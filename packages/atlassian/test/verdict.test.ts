import { describe, expect, it } from 'vitest';
import { executionVerdict } from '../src/engines/piv.ts';

const verdict = (text: string) => executionVerdict({ text, rel: 'r.md', name: 'r.md' } as Parameters<typeof executionVerdict>[0]);

describe('execution report verdict', () => {
  it('reads the template\'s "Validation Results" list', () => {
    expect(verdict('# R\n\n## Validation Results\n\n- Unit: ✓ 4 passed\n- Lint: ✗ 2 errors\n\n## Notes\n- ✓ not counted')).toMatchObject({ status: 'failed', score: '1/2 validation checks passed' });
  });

  it('also reads a "## Validation" table (as agents write it headless)', () => {
    const table = '# R\n\n## Validation\n\n| # | Check | Result |\n|---|---|---|\n| 1 | quotes commas | ✓ |\n| 2 | doubles quotes | ✓ |\n\n## Divergences\n\nNone ✗ here is not a check';
    expect(verdict(table)).toMatchObject({ status: 'passed', score: '2/2 validation checks passed' });
  });

  it('is unknown without checks', () => {
    expect(verdict('# R\n\nAll good.').status).toBe('unknown');
  });
});
