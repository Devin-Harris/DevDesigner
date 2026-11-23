import { LruCache } from '../../../shared/helpers/lru';
import type { CodeLanguage } from '@devdesigner/shared';

/**
 * A tiny dependency-free syntax highlighter for canvas code blocks. It is a
 * regex tokenizer, not a parser: good enough to color keywords, strings,
 * comments, numbers and types for a diagram, and it keeps the bundle free of a
 * highlighting library. Highlighting is a render concern; only raw code and the
 * language key are ever persisted.
 */

export type { TokenKind } from './code-languages';
import type { TokenKind } from './code-languages';

export interface CodeToken {
   text: string;
   kind: TokenKind;
}

import { LANGUAGES } from './code-languages';

/**
 * A line that is nothing but an ellipsis (optionally inside a comment) is an
 * "elision": it marks code the author chose not to show, and renders as a muted
 * gap row without a line number.
 */
const ELISION_LINE = /^\s*(?:\/\/|#|--|\/\*|<!--)?\s*(?:\.{3}|…)\s*(?:\*\/|-->)?\s*$/;
export function isElisionLine(line: string): boolean {
   return ELISION_LINE.test(line);
}

/** An inline `...` that stands in for an argument, member or body: `foo(...)`, `{ ... }`. */
const INLINE_ELISION = /(?:\.{3}|…)(?=\s*(?:[)\]},;]|\n|$))/y;

/** The highlight languages offered in the UI, with display names. */
export const CODE_LANGUAGE_LABELS: Record<CodeLanguage, string> = {
   plaintext: 'Plain text',
   typescript: 'TypeScript',
   sql: 'SQL',
   json: 'JSON',
   python: 'Python',
   csharp: 'C#',
   java: 'Java',
   html: 'HTML',
   css: 'CSS',
   scss: 'SCSS',
   bash: 'Bash',
   javascript: 'JavaScript',
   go: 'Go',
   rust: 'Rust',
   c: 'C',
   cpp: 'C++',
   php: 'PHP',
   ruby: 'Ruby',
   kotlin: 'Kotlin',
   swift: 'Swift',
   dart: 'Dart',
   lua: 'Lua',
   powershell: 'PowerShell',
   yaml: 'YAML',
   xml: 'XML',
   markdown: 'Markdown',
   dockerfile: 'Dockerfile',
   graphql: 'GraphQL',
};

/** File extension (no dot) a language's code would live under. */
export const CODE_LANGUAGE_EXTENSIONS: Record<CodeLanguage, string> = {
   plaintext: 'txt',
   typescript: 'ts',
   sql: 'sql',
   json: 'json',
   python: 'py',
   csharp: 'cs',
   java: 'java',
   html: 'html',
   css: 'css',
   scss: 'scss',
   bash: 'sh',
   javascript: 'js',
   go: 'go',
   rust: 'rs',
   c: 'c',
   cpp: 'cpp',
   php: 'php',
   ruby: 'rb',
   kotlin: 'kt',
   swift: 'swift',
   dart: 'dart',
   lua: 'lua',
   powershell: 'ps1',
   yaml: 'yaml',
   xml: 'xml',
   markdown: 'md',
   dockerfile: 'dockerfile',
   graphql: 'graphql',
};

/** The language a file name's extension says its code is in (null when unknown). */
export function languageForFileName(fileName: string): CodeLanguage | null {
   if (/^(?:.*[\\/])?dockerfile(?:\..*)?$/i.test(fileName.trim())) return 'dockerfile';
   const ext = /.([A-Za-z0-9]+)$/.exec(fileName.trim())?.[1]?.toLowerCase();
   if (!ext) return null;
   const extra: Record<string, CodeLanguage> = {
      tsx: 'typescript',
      jsx: 'javascript',
      mjs: 'javascript',
      cjs: 'javascript',
      h: 'c',
      hpp: 'cpp',
      cc: 'cpp',
      cxx: 'cpp',
      hh: 'cpp',
      kts: 'kotlin',
      yml: 'yaml',
      svg: 'xml',
      csproj: 'xml',
      gql: 'graphql',
      psm1: 'powershell',
      rake: 'ruby',
      htm: 'html',
      bash: 'bash',
      zsh: 'bash',
   };
   const own = (Object.keys(CODE_LANGUAGE_EXTENSIONS) as CodeLanguage[]).find(
      (l) => CODE_LANGUAGE_EXTENSIONS[l] === ext
   );
   return own ?? extra[ext] ?? null;
}

/** Tab stop used when laying out tabs (matches the editor textarea's `tab-size`). */
export const TAB_SIZE = 2;

/** Expand tabs to spaces, column-aware, so rendered and typed columns line up. */
export function expandTabs(line: string): string {
   if (!line.includes('\t')) {
      return line;
   }
   let out = '';
   for (const ch of line) {
      out += ch === '\t' ? ' '.repeat(TAB_SIZE - (out.length % TAB_SIZE)) : ch;
   }
   return out;
}

/**
 * Tokenize code into lines of colored tokens. Multi-line tokens (block comments,
 * template/triple-quoted strings) are split at newlines so each line is
 * independent for layout. Always returns at least one (possibly empty) line.
 */
export function tokenizeCode(code: string, language: CodeLanguage | string | undefined): CodeToken[][] {
   return tokenCache.getOrSet(`${language ?? ''}\u0001${code}`, () => tokenizeUncached(code, language));
}

/** (language, code) -> token lines. Shared between callers: treat the result as read-only. */
const tokenCache = new LruCache<string, CodeToken[][]>(300);

function tokenizeUncached(code: string, language: CodeLanguage | string | undefined): CodeToken[][] {
   // Legacy blocks saved as 'javascript' render as TypeScript.
   const id = language === 'javascript' ? 'typescript' : language;
   const rules = LANGUAGES[(id as CodeLanguage) ?? 'plaintext'] ?? LANGUAGES.plaintext;
   const lines: CodeToken[][] = [[]];
   const push = (text: string, kind: TokenKind): void => {
      const parts = text.split('\n');
      parts.forEach((part, i) => {
         if (i > 0) {
            lines.push([]);
         }
         if (part === '') {
            return;
         }
         const line = lines[lines.length - 1];
         const last = line[line.length - 1];
         if (last && last.kind === kind) {
            last.text += part;
         } else {
            line.push({ text: part, kind });
         }
      });
   };

   const src = code.replace(/\r\n?/g, '\n');
   let pos = 0;
   while (pos < src.length) {
      let matched = false;
      INLINE_ELISION.lastIndex = pos;
      const gap = INLINE_ELISION.exec(src);
      if (gap) {
         push(gap[0], 'elision');
         pos += gap[0].length;
         continue;
      }
      for (const [kind, re] of rules) {
         re.lastIndex = pos;
         const m = re.exec(src);
         if (m && m[0].length > 0) {
            push(m[0], kind);
            pos += m[0].length;
            matched = true;
            break;
         }
      }
      if (!matched) {
         // Whitespace and anything unrecognised: take it through as plain text.
         const ws = /^[ \t]+/.exec(src.slice(pos, pos + 256));
         const len = ws ? ws[0].length : 1;
         push(src.slice(pos, pos + len), 'plain');
         pos += len;
      }
   }
   return lines;
}

/** Token colors for a code surface. `dark` selects the palette. */
export interface CodePalette {
   dark: boolean;
   /** Fallback surface when the element has no fill of its own. */
   background: string;
   plain: string;
   /** Muted color for line numbers and the language label. */
   muted: string;
   kinds: Record<Exclude<TokenKind, 'plain'>, string>;
}

const DARK_PALETTE: CodePalette = {
   dark: true,
   background: '#1b1f27',
   plain: '#d7dae0',
   muted: '#6b7280',
   kinds: {
      keyword: '#c678dd',
      string: '#98c379',
      comment: '#7f848e',
      number: '#d19a66',
      type: '#e5c07b',
      function: '#61afef',
      operator: '#56b6c2',
      punct: '#abb2bf',
      tag: '#e06c75',
      attr: '#d19a66',
      property: '#e06c75',
      constant: '#d19a66',
      variable: '#e06c75',
      elision: '#6b7280',
   },
};

const LIGHT_PALETTE: CodePalette = {
   dark: false,
   background: '#f6f8fa',
   plain: '#24292f',
   muted: '#8c959f',
   kinds: {
      keyword: '#cf222e',
      string: '#0a3069',
      comment: '#6e7781',
      number: '#0550ae',
      type: '#953800',
      function: '#8250df',
      operator: '#0550ae',
      punct: '#57606a',
      tag: '#116329',
      attr: '#0550ae',
      property: '#0550ae',
      constant: '#0550ae',
      variable: '#953800',
      elision: '#8c959f',
   },
};

export function codePalette(dark: boolean): CodePalette {
   return dark ? DARK_PALETTE : LIGHT_PALETTE;
}

export function tokenColor(palette: CodePalette, kind: TokenKind): string {
   return kind === 'plain' ? palette.plain : palette.kinds[kind];
}
