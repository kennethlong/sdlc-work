import { describe, expect, it } from 'vitest';
import { jiraWikiToMarkdown, markdownToJiraWiki, markdownToStorage, storageToMarkdown } from '../src/markup.ts';

const sample = `# Title

Some **bold**, *italic*, \`code\` and a [link](https://example.com).

- one
- two
  - nested
1. first
2. second

- [x] done
- [ ] todo

\`\`\`ts
const a = 1 < 2 && 3 > 2;
\`\`\`

> quoted

| A | B |
|---|---|
| 1 | 2 |
`;

describe('markdownToJiraWiki', () => {
  const wiki = markdownToJiraWiki(sample);

  it('converts headings and inline marks', () => {
    expect(wiki).toContain('h1. Title');
    expect(wiki).toContain('Some *bold*, _italic_, {{code}} and a [link|https://example.com].');
  });

  it('escapes braces and brackets inside inline code, and round-trips them', () => {
    const w = markdownToJiraWiki('Call `GET /reports/{id}/export.csv` or `a[0] < b`.');
    expect(w).toBe('Call {{GET /reports/\\{id\\}/export.csv}} or {{a\\[0\\] < b}}.');
    expect(jiraWikiToMarkdown(w)).toBe('Call `GET /reports/{id}/export.csv` or `a[0] < b`.');
  });

  it('escapes text that Jira would read as markup', () => {
    expect(markdownToJiraWiki('Use {placeholder} and [not a link] or a|b')).toBe('Use \\{placeholder\\} and \\[not a link\\] or a\\|b');
    expect(markdownToJiraWiki('Run it with -v and -q')).toBe('Run it with \\-v and \\-q');
    expect(markdownToJiraWiki('Pass \\*args here')).toBe('Pass \\*args here');
    expect(markdownToJiraWiki('Wow!great')).toBe('Wow\\!great');
    expect(markdownToJiraWiki('\\#1 priority')).toBe('\\#1 priority');
  });

  it('leaves ordinary punctuation alone', () => {
    for (const s of ['snake_case_name stays', 'a - b - c', '2 * 3 = 6', 'Done! Next.', 'C++ and x^2 are fine']) {
      expect(markdownToJiraWiki(s)).toBe(s);
    }
  });

  it('round-trips escaped text back to the same markdown', () => {
    for (const s of ['Use {placeholder} and [not a link] or a|b', 'Run it with -v and -q', 'a - b - c']) {
      expect(jiraWikiToMarkdown(markdownToJiraWiki(s))).toBe(s);
    }
  });

  it('converts nested and ordered lists', () => {
    expect(wiki).toContain('* one\n* two\n** nested');
    expect(wiki).toContain('# first\n# second');
  });

  it('keeps task list state', () => {
    expect(wiki).toContain('* [x] done\n* [ ] todo');
  });

  it('converts code, quotes and tables', () => {
    expect(wiki).toContain('{code:ts}\nconst a = 1 < 2 && 3 > 2;\n{code}');
    expect(wiki).toContain('{quote}\nquoted\n{quote}');
    expect(wiki).toContain('||A||B||\n|1|2|');
  });
});

describe('jiraWikiToMarkdown', () => {
  it('round-trips the common subset', () => {
    const md = jiraWikiToMarkdown(markdownToJiraWiki(sample));
    expect(md).toContain('# Title');
    expect(md).toContain('**bold**');
    expect(md).toContain('*italic*');
    expect(md).toContain('`code`');
    expect(md).toContain('[link](https://example.com)');
    expect(md).toContain('- one\n- two\n  - nested');
    expect(md).toContain('```ts\nconst a = 1 < 2 && 3 > 2;\n```');
  });

  it('does not touch code block contents', () => {
    expect(jiraWikiToMarkdown('{code}\n*not bold* _x_\n{code}')).toBe('```\n*not bold* _x_\n```');
  });
});

describe('Confluence storage format', () => {
  const storage = markdownToStorage(sample);

  it('emits a code macro with verbatim body', () => {
    expect(storage).toContain('<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">ts</ac:parameter>');
    expect(storage).toContain('<![CDATA[const a = 1 < 2 && 3 > 2;]]>');
  });

  it('self-closes void elements', () => {
    expect(markdownToStorage('a  \nb\n\n---')).toMatch(/<br \/>[\s\S]*<hr \/>/);
  });

  it('converts storage back to markdown', () => {
    const md = storageToMarkdown(storage);
    expect(md).toContain('# Title');
    expect(md).toContain('**bold**');
    expect(md).toContain('```ts\nconst a = 1 < 2 && 3 > 2;\n```');
    expect(md).toMatch(/\|\s*A\s*\|\s*B\s*\|/);
  });
});
