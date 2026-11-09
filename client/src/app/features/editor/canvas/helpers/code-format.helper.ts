import type { CodeLanguage } from '@devdesigner/shared';
import { isElisionLine } from './code-highlight.helper';

/**
 * Prettier formatting for code blocks. Prettier (and its parsers) are loaded
 * lazily, only when a block is actually formatted, so they stay out of the main
 * bundle. Only languages Prettier ships a browser parser for are formattable.
 *
 * Snippets on a canvas are rarely complete programs, so two things are handled:
 *  - `...` placeholders (whole lines or inline in a call/object) are swapped for
 *    parseable stand-ins before formatting and restored afterwards;
 *  - a TS/JS snippet that only parses as a class body (a bare method) is retried
 *    wrapped in a class and unwrapped again.
 */

const FORMATTABLE: readonly CodeLanguage[] = [
  'typescript',
  'json',
  'html',
  'css',
  'sql',
];

export function canFormatCode(language: CodeLanguage | undefined): boolean {
  return FORMATTABLE.includes(language ?? 'typescript');
}

const LINE_MARK = '@@dd-elide@@';
const INLINE_MARK = '__dd_elide__';
const INLINE_ELISION = /(?:\.{3}|\u2026)(?=\s*(?:[)\]},;]|$))/gm;

/** A comment that can carry a whole-line elision in each language. */
function lineMarker(language: CodeLanguage): string {
  switch (language) {
    case 'css':
      return `/* ${LINE_MARK} */`;
    case 'html':
      return `<!-- ${LINE_MARK} -->`;
    case 'sql':
      return `-- ${LINE_MARK}`;
    default:
      return `// ${LINE_MARK}`;
  }
}

const RESTORE_LINE = new RegExp(
  `^([ \\t]*)(?:// ${LINE_MARK}|/\\* ${LINE_MARK} \\*/|<!-- ${LINE_MARK} -->|-- ${LINE_MARK})[ \\t]*$`,
  'gm',
);

function protect(text: string, language: CodeLanguage): string {
  const marker = lineMarker(language);
  const lines = text.split('\n').map((line) => {
    if (isElisionLine(line)) {
      return `${/^\s*/.exec(line)?.[0] ?? ''}${marker}`;
    }
    return language === 'typescript'
      ? line.replace(INLINE_ELISION, INLINE_MARK)
      : line;
  });
  return lines.join('\n');
}

function restore(text: string): string {
  return text.replace(RESTORE_LINE, '$1...').split(INLINE_MARK).join('...');
}

interface PrettierOptions {
  parser: string;
  plugins: unknown[];
}

async function optionsFor(language: CodeLanguage): Promise<PrettierOptions> {
  switch (language) {
    case 'typescript': {
      const [ts, estree] = await Promise.all([
        import('prettier/plugins/typescript'),
        import('prettier/plugins/estree'),
      ]);
      return { parser: 'typescript', plugins: [ts, estree] };
    }
    case 'json': {
      const [babel, estree] = await Promise.all([
        import('prettier/plugins/babel'),
        import('prettier/plugins/estree'),
      ]);
      return { parser: language === 'json' ? 'json' : 'babel', plugins: [babel, estree] };
    }
    case 'css': {
      const postcss = await import('prettier/plugins/postcss');
      return { parser: 'css', plugins: [postcss] };
    }
    default: {
      const [html, postcss, babel, estree] = await Promise.all([
        import('prettier/plugins/html'),
        import('prettier/plugins/postcss'),
        import('prettier/plugins/babel'),
        import('prettier/plugins/estree'),
      ]);
      return { parser: 'html', plugins: [html, postcss, babel, estree] };
    }
  }
}

/** Strip the synthetic class wrapper and its one level of indentation. */
function unwrapClass(text: string): string {
  const lines = text.replace(/\n$/, '').split('\n');
  return lines
    .slice(1, -1)
    .map((l) => (l.startsWith('  ') ? l.slice(2) : l))
    .join('\n');
}

/**
 * Format `text` as `language`. `printWidth` should reflect how wide the card is;
 * the default suits a typical diagram card. Throws an Error with a readable
 * message when the code cannot be parsed.
 */
export async function formatCode(
  text: string,
  language: CodeLanguage | undefined,
  printWidth = 80,
): Promise<string> {
  const lang = language ?? 'typescript';
  if (!canFormatCode(lang)) {
    throw new Error('Formatting is not available for this language.');
  }
  if (lang === 'sql') {
    return formatSql(text, printWidth);
  }
  const prettier = await import('prettier/standalone');
  const options = await optionsFor(lang);
  const base = {
    ...options,
    printWidth,
    tabWidth: 2,
    singleQuote: true,
    trailingComma: 'all' as const,
  };
  const source = protect(text.replace(/\r\n?/g, '\n'), lang);
  const run = (code: string): Promise<string> =>
    prettier.format(code, base as Parameters<typeof prettier.format>[1]);
  let out: string;
  try {
    out = await run(source);
  } catch (err) {
    if (lang !== 'typescript') {
      throw cleanError(err);
    }
    // A bare method/property is only valid inside a class body.
    try {
      out = unwrapClass(await run(`class __DdSnippet {\n${source}\n}`));
    } catch {
      throw cleanError(err);
    }
  }
  return restore(out.replace(/\n+$/, ''));
}

/** SQL is not a Prettier language; `sql-formatter` handles it (also lazy-loaded). */
async function formatSql(text: string, printWidth: number): Promise<string> {
  const { format } = await import('sql-formatter');
  const source = protect(text.replace(/\r\n?/g, '\n'), 'sql');
  try {
    const out = format(source, {
      language: 'sql',
      tabWidth: 2,
      keywordCase: 'upper',
      expressionWidth: Math.max(printWidth, 20),
    });
    return restore(out.replace(/\n+$/, ''));
  } catch (err) {
    throw cleanError(err);
  }
}

function cleanError(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err);
  // Prettier appends a source frame; the first line is the useful part.
  return new Error(raw.split('\n')[0].replace(/^SyntaxError:\s*/, ''));
}
