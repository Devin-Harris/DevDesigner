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

const PRETTIER: readonly CodeLanguage[] = ['typescript', 'json', 'html', 'css', 'scss'];

/** Every language can be formatted: Prettier/sql-formatter where they exist, a reindenter otherwise. */
export function canFormatCode(_language: CodeLanguage | undefined): boolean {
   return true;
}

/** A plugin module as Prettier wants it (bundlers may wrap CommonJS ones in `default`). */
function plugin(m: unknown): unknown {
   const mod = m as { default?: unknown; parsers?: unknown; printers?: unknown };
   return mod.parsers || mod.printers ? mod : (mod.default ?? mod);
}

const LINE_MARK = '@@dd-elide@@';
const INLINE_MARK = '__dd_elide__';
const INLINE_ELISION = /(?:\.{3}|\u2026)(?=\s*(?:[)\]},;]|$))/gm;

/** A comment that can carry a whole-line elision in each language. */
function lineMarker(language: CodeLanguage): string {
   switch (language) {
      case 'css':
      case 'scss':
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
   'gm'
);

function protect(text: string, language: CodeLanguage): string {
   const marker = lineMarker(language);
   const lines = text.split('\n').map((line) => {
      if (isElisionLine(line)) {
         return `${/^\s*/.exec(line)?.[0] ?? ''}${marker}`;
      }
      return language === 'typescript' ? line.replace(INLINE_ELISION, INLINE_MARK) : line;
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
         return { parser: 'typescript', plugins: [plugin(ts), plugin(estree)] };
      }
      case 'json': {
         const [babel, estree] = await Promise.all([
            import('prettier/plugins/babel'),
            import('prettier/plugins/estree'),
         ]);
         return { parser: language === 'json' ? 'json' : 'babel', plugins: [plugin(babel), plugin(estree)] };
      }
      case 'css':
      case 'scss': {
         const postcss = await import('prettier/plugins/postcss');
         return { parser: language, plugins: [plugin(postcss)] };
      }
      default: {
         const [html, postcss, babel, estree] = await Promise.all([
            import('prettier/plugins/html'),
            import('prettier/plugins/postcss'),
            import('prettier/plugins/babel'),
            import('prettier/plugins/estree'),
         ]);
         return { parser: 'html', plugins: [html, postcss, babel, estree].map(plugin) };
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
export async function formatCode(text: string, language: CodeLanguage | undefined, printWidth = 80): Promise<string> {
   const lang = language ?? 'typescript';
   if (lang === 'sql') {
      return formatSql(text, printWidth);
   }
   if (!PRETTIER.includes(lang)) {
      return reindent(text, lang);
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
   const run = (code: string): Promise<string> => prettier.format(code, base as Parameters<typeof prettier.format>[1]);
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
      } catch (wrappedErr) {
         // Report whichever attempt got further: a snippet of methods fails at its first
         // line unwrapped, but its real mistake is wherever the class-wrapped parse stops.
         const first = cleanError(err);
         const wrapped = cleanError(wrappedErr);
         const wrappedLine = wrapped.line != null ? wrapped.line - 1 : undefined;
         if (wrappedLine != null && wrappedLine >= 1 && wrappedLine > (first.line ?? 0)) {
            throw new CodeFormatError(wrapped.reason, wrappedLine, wrapped.column);
         }
         throw first;
      }
   }
   return breakLongImports(restore(out.replace(/\n+$/, '')), printWidth);
}

/**
 * Prettier never breaks an import/export of a single braced name, so a long one overflows
 * the width. Split any such line that is too wide over several lines to stay in bounds.
 */
export function breakLongImports(code: string, printWidth: number): string {
   return code
      .split('\n')
      .map((line) => {
         if (line.length <= printWidth) return line;
         const m = /^(\s*)((?:import|export)(?: type)?) \{ ([^{}]+?) \} from (.+)$/.exec(line);
         if (!m) return line;
         const [, indent, head, names, rest] = m;
         const items = names
            .split(/,\s*/)
            .filter(Boolean)
            .map((n) => `${indent}  ${n},`);
         return [`${indent}${head} {`, ...items, `${indent}} from ${rest}`].join('\n');
      })
      .join('\n');
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

/** Why code could not be formatted, with the 1-based line/column of the problem when known. */
export class CodeFormatError extends Error {
   constructor(
      readonly reason: string,
      readonly line?: number,
      readonly column?: number
   ) {
      super(line ? `line ${line}${column ? `, col ${column}` : ''}: ${reason}` : reason);
      this.name = 'CodeFormatError';
   }
}

function cleanError(err: unknown): CodeFormatError {
   const raw = err instanceof Error ? err.message : String(err);
   // Prettier appends a source frame; the first line is the useful part.
   let reason = raw.split('\n')[0].replace(/^SyntaxError:\s*/, '').trim();
   const loc = (err as { loc?: { start?: { line?: number; column?: number } } } | null)?.loc?.start;
   let line = loc?.line;
   let column = loc?.column;
   // "Unexpected token (3:5)" (Prettier) / "... at line 3 column 5" (sql-formatter).
   const paren = /\s*\((\d+):(\d+)\)\s*$/.exec(reason);
   if (paren) {
      line ??= Number(paren[1]);
      column ??= Number(paren[2]);
      reason = reason.slice(0, paren.index);
   }
   const words = /\bline:?\s*(\d+),?\s*col(?:umn)?:?\s*(\d+)/i.exec(raw);
   if (words) {
      line ??= Number(words[1]);
      column ??= Number(words[2]);
   }
   return new CodeFormatError(reason || 'Could not format the code.', line, column);
}

/**
 * Formatting for languages without a browser formatter: tabs become 2 spaces, trailing
 * spaces and runs of blank lines go, and brace languages are re-indented by nesting
 * (strings and comments are skipped when counting braces). Python/bash keep their own
 * indentation, only normalized to 2-space steps.
 */
export function reindent(text: string, language: CodeLanguage): string {
   const lines = text
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((l) => l.replace(/\t/g, '  ').replace(/\s+$/, ''));
   const out: string[] = [];
   const braces = language === 'csharp' || language === 'java';
   if (braces) {
      let depth = 0;
      let inBlock = false;
      for (const raw of lines) {
         const line = raw.trim();
         const code = stripNonCode(line, inBlock);
         inBlock = code.inBlock;
         const opens = (code.text.match(/[{([]/g) ?? []).length;
         const closes = (code.text.match(/[})\]]/g) ?? []).length;
         const leading = /^[})\]]+/.exec(code.text)?.[0].length ?? 0;
         const at = Math.max(0, depth - leading);
         out.push(line ? '  '.repeat(at) + line : '');
         depth = Math.max(0, depth + opens - closes);
      }
   } else if (language === 'python' || language === 'bash') {
      // Map the existing indent widths onto 2-space levels.
      const widths = [...new Set(lines.filter((l) => l.trim()).map((l) => /^ */.exec(l)![0].length))].sort(
         (a, b) => a - b
      );
      for (const l of lines) {
         const w = /^ */.exec(l)![0].length;
         out.push(l.trim() ? '  '.repeat(widths.indexOf(w)) + l.trimStart() : '');
      }
   } else {
      out.push(...lines);
   }
   return out
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\n+|\n+$/g, '');
}

/** The code part of a line: string/char literals and comments blanked out. */
function stripNonCode(line: string, inBlock: boolean): { text: string; inBlock: boolean } {
   let text = '';
   for (let i = 0; i < line.length; i += 1) {
      if (inBlock) {
         if (line.startsWith('*/', i)) {
            inBlock = false;
            i += 1;
         }
         continue;
      }
      const ch = line[i];
      if (line.startsWith('//', i)) break;
      if (line.startsWith('/*', i)) {
         inBlock = true;
         i += 1;
         continue;
      }
      if (ch === '"' || ch === "'") {
         const end = line.indexOf(ch, i + 1);
         i = end < 0 ? line.length : end;
         continue;
      }
      text += ch;
   }
   return { text, inBlock };
}

/**
 * Every line that keeps `text` from formatting, not just the first: parsers stop at their
 * first error, so each failing line is blanked (keeping line numbers) and the code re-parsed
 * until it formats or no new line is found. Empty when the code formats.
 */
export async function findFormatErrors(
   text: string,
   language: CodeLanguage | undefined,
   printWidth = 80,
   max = 25
): Promise<CodeFormatError[]> {
   const errors: CodeFormatError[] = [];
   const lines = text.replace(/\r\n?/g, '\n').split('\n');
   const seen = new Set<number>();
   for (let i = 0; i < max; i++) {
      try {
         await formatCode(lines.join('\n'), language, printWidth);
         return errors;
      } catch (err) {
         const e = err instanceof CodeFormatError ? err : new CodeFormatError(err instanceof Error ? err.message : String(err));
         if (e.line == null || e.line < 1 || e.line > lines.length || seen.has(e.line)) {
            if (!errors.length) errors.push(e);
            return errors;
         }
         errors.push(e);
         seen.add(e.line);
         lines[e.line - 1] = '';
      }
   }
   return errors;
}
