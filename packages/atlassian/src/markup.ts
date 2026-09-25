/**
 * Format conversions between markdown (what agents and GSD write) and what DC products store:
 *   - Jira DC issue fields/comments: wiki markup
 *   - Confluence DC pages: XHTML "storage format"
 */
import { marked, type Token, type Tokens } from 'marked';
import TurndownService from 'turndown';
import { gfm } from '@joplin/turndown-plugin-gfm';

// ---------------------------------------------------------------------------------------------
// markdown -> Jira wiki markup
// ---------------------------------------------------------------------------------------------

export function markdownToJiraWiki(md: string): string {
  return blocks(marked.lexer(md), 0).trim();
}

function blocks(tokens: Token[], listDepth: number): string {
  return tokens.map((t) => block(t, listDepth)).filter((s) => s !== '').join('\n\n');
}

function block(t: Token, listDepth: number): string {
  switch (t.type) {
    case 'heading':
      return `h${(t as Tokens.Heading).depth}. ${inline((t as Tokens.Heading).tokens)}`;
    case 'paragraph':
      return inline((t as Tokens.Paragraph).tokens);
    case 'text':
      return (t as Tokens.Text).tokens ? inline((t as Tokens.Text).tokens!) : (t as Tokens.Text).text;
    case 'code': {
      const c = t as Tokens.Code;
      return `{code${c.lang ? `:${c.lang}` : ''}}\n${c.text}\n{code}`;
    }
    case 'blockquote':
      return `{quote}\n${blocks((t as Tokens.Blockquote).tokens, listDepth)}\n{quote}`;
    case 'hr':
      return '----';
    case 'list':
      return list(t as Tokens.List, listDepth + 1, '');
    case 'table': {
      const tb = t as Tokens.Table;
      const head = `||${tb.header.map((h) => inline(h.tokens)).join('||')}||`;
      const rows = tb.rows.map((r) => `|${r.map((c) => inline(c.tokens) || ' ').join('|')}|`);
      return [head, ...rows].join('\n');
    }
    case 'space':
      return '';
    default:
      return 'raw' in t ? String(t.raw).trim() : '';
  }
}

function list(l: Tokens.List, depth: number, prefix: string): string {
  const marker = prefix + (l.ordered ? '#' : '*');
  return l.items
    .map((item) => {
      const text: string[] = [];
      const nested: string[] = [];
      for (const child of item.tokens) {
        if (child.type === 'list') nested.push(list(child as Tokens.List, depth + 1, marker));
        else text.push(block(child, depth));
      }
      // Task items: marked emits a `checkbox` token ("[x]" / "[ ]"), rendered by block()'s default branch.
      return [`${marker} ${text.filter(Boolean).join(' ')}`, ...nested].join('\n');
    })
    .join('\n');
}

function inline(tokens: Token[] = []): string {
  return tokens
    .map((t) => {
      switch (t.type) {
        case 'strong':
          return `*${inline((t as Tokens.Strong).tokens)}*`;
        case 'em':
          return `_${inline((t as Tokens.Em).tokens)}_`;
        case 'del':
          return `-${inline((t as Tokens.Del).tokens)}-`;
        case 'codespan':
          // Escape braces/brackets: Jira reads `{id}` inside {{...}} as a macro and `[x]` as a link.
          return `{{${decode((t as Tokens.Codespan).text).replace(/[{}[\]]/g, '\\$&')}}}`;
        case 'link': {
          const l = t as Tokens.Link;
          const text = inline(l.tokens);
          return text && text !== l.href ? `[${text}|${l.href}]` : `[${l.href}]`;
        }
        case 'image':
          return `!${(t as Tokens.Image).href}!`;
        case 'br':
          return '\n';
        case 'text':
          return (t as Tokens.Text).tokens ? inline((t as Tokens.Text).tokens!) : decode((t as Tokens.Text).text);
        case 'escape':
          return (t as Tokens.Escape).text;
        default:
          return 'raw' in t ? String(t.raw) : '';
      }
    })
    .join('');
}

function decode(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// ---------------------------------------------------------------------------------------------
// Jira wiki markup -> markdown (for handing issue text to agents; covers the common subset)
// ---------------------------------------------------------------------------------------------

export function jiraWikiToMarkdown(wiki: string): string {
  const codeBlocks: string[] = [];
  let s = wiki.replace(/\r\n/g, '\n');
  // Protect code/noformat blocks from inline rewriting.
  // (?<!\{) / (?!\}) keep inline monospace like {{code}} from being read as a block marker.
  s = s.replace(/(?<!\{)\{(code|noformat)(?::([^}]*))?\}(?!\})([\s\S]*?)(?<!\{)\{\1\}(?!\})/g, (_m, _k, lang: string | undefined, body: string) => {
    const language = (lang ?? '').split('|')[0]!.replace(/^language=/, '').trim();
    codeBlocks.push('```' + language + '\n' + body.replace(/^\n|\n$/g, '') + '\n```');
    return `\u0000${codeBlocks.length - 1}\u0000`;
  });
  s = s
    // Lists before headings: once "h1." becomes "# " it would read as a numbered list.
    .replace(/^([*#]+)\s+/gm, (_m, marks: string) => {
      const indent = '  '.repeat(marks.length - 1);
      return indent + (marks.endsWith('#') ? '1. ' : '- ');
    })
    .replace(/^h([1-6])\.\s*/gm, (_m, d: string) => '#'.repeat(Number(d)) + ' ')
    .replace(/^\|\|(.*)\|\|\s*$/gm, (_m, cells: string) => {
      const cols = cells.split('||');
      return `| ${cols.join(' | ')} |\n|${cols.map(() => ' --- ').join('|')}|`;
    })
    .replace(/\{quote\}([\s\S]*?)\{quote\}/g, (_m, body: string) => body.trim().split('\n').map((l) => `> ${l}`).join('\n'))
    .replace(/\{\{((?:\\.|[^}\\])+)\}\}/g, (_m, code: string) => '`' + code.replace(/\\([{}[\]])/g, '$1') + '`')
    .replace(/\[([^|\]]+)\|([^\]]+)\]/g, '[$1]($2)')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,:;!?]|$)/gm, '$1**$2**')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,:;!?]|$)/gm, '$1*$2*')
    .replace(/(^|[\s(])-([^-\n]+)-(?=[\s).,:;!?]|$)/gm, '$1~~$2~~')
    .replace(/^----\s*$/gm, '---');
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => codeBlocks[Number(i)]!).trim();
}

// ---------------------------------------------------------------------------------------------
// markdown <-> Confluence storage format
// ---------------------------------------------------------------------------------------------

export function markdownToStorage(md: string): string {
  const html = marked.parse(md, { async: false, gfm: true }) as string;
  return (
    html
      // Fenced code -> Confluence code macro (CDATA keeps the body verbatim).
      .replace(/<pre><code(?: class="language-([^"]+)")?>([\s\S]*?)<\/code><\/pre>/g, (_m, lang: string | undefined, code: string) => {
        const body = decode(code).replace(/\n$/, '').replace(/]]>/g, ']]]]><![CDATA[>');
        const langParam = lang ? `<ac:parameter ac:name="language">${lang}</ac:parameter>` : '';
        return `<ac:structured-macro ac:name="code">${langParam}<ac:plain-text-body><![CDATA[${body}]]></ac:plain-text-body></ac:structured-macro>`;
      })
      // Storage format is XHTML: void elements must be self-closed.
      .replace(/<(br|hr)>/g, '<$1 />')
      .replace(/<(img|input)([^>]*?)\s*\/?>/g, '<$1$2 />')
      .trim()
  );
}

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*' });
turndown.use(gfm);
turndown.addRule('confluenceCode', {
  filter: (node) => node.nodeName === 'AC:STRUCTURED-MACRO' && node.getAttribute('ac:name') === 'code',
  replacement: (_content, node) => {
    const el = node as unknown as Element;
    const lang = el.querySelector('ac\\:parameter[ac\\:name="language"]')?.textContent ?? '';
    const body = el.querySelector('ac\\:plain-text-body')?.textContent ?? '';
    return `\n\n\`\`\`${lang}\n${body}\n\`\`\`\n\n`;
  },
});

export function storageToMarkdown(storage: string): string {
  // CDATA isn't understood by the HTML parser turndown uses; unwrap it (escaping the text) first.
  const html = storage.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_m, t: string) =>
    t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  );
  return turndown.turndown(html).trim();
}
