import type { CodeLanguage } from '@dbdesigner/shared';

/**
 * A tiny dependency-free syntax highlighter for canvas code blocks. It is a
 * regex tokenizer, not a parser: good enough to color keywords, strings,
 * comments, numbers and types for a diagram, and it keeps the bundle free of a
 * highlighting library. Highlighting is a render concern; only raw code and the
 * language key are ever persisted.
 */

export type TokenKind =
  | 'plain'
  | 'keyword'
  | 'string'
  | 'comment'
  | 'number'
  | 'type'
  | 'function'
  | 'operator'
  | 'punct'
  | 'tag'
  | 'attr'
  | 'property'
  | 'constant'
  | 'variable'
  /** A `...` placeholder standing in for code that is deliberately not shown. */
  | 'elision';

export interface CodeToken {
  text: string;
  kind: TokenKind;
}

type Rule = readonly [TokenKind, RegExp];

/** Compile a keyword list into one sticky, word-bounded alternation. */
function words(list: string, flags = ''): RegExp {
  return new RegExp(`\\b(?:${list.split(/\s+/).join('|')})\\b`, `y${flags}`);
}

const sticky = (source: string, flags = ''): RegExp => new RegExp(source, `y${flags}`);

const JS_KEYWORDS =
  'abstract as async await break case catch class const continue debugger declare default delete do else enum export extends finally for from function get if implements import in instanceof interface is keyof let namespace new of override private protected public readonly return satisfies set static super switch this throw try type typeof var void while with yield';

const C_STRINGS: Rule[] = [
  ['string', sticky('"(?:\\\\.|[^"\\\\\\n])*(?:"|$)', 'm')],
  ['string', sticky("'(?:\\\\.|[^'\\\\\\n])*(?:'|$)", 'm')],
];

const C_COMMENTS: Rule[] = [
  ['comment', sticky('//[^\\n]*')],
  ['comment', sticky('/\\*[\\s\\S]*?(?:\\*/|$)')],
];

const COMMON_TAIL: Rule[] = [
  ['function', sticky('[A-Za-z_$][\\w$]*(?=\\s*\\()')],
  ['type', sticky('\\b[A-Z][\\w$]*\\b')],
  ['plain', sticky('[A-Za-z_$][\\w$]*')],
  ['operator', sticky('[+\\-*/%=<>!&|^~?:]+')],
  ['punct', sticky('[{}()[\\];,.]')],
];

const NUMBER: Rule = [
  'number',
  sticky('\\b(?:0[xX][\\da-fA-F_]+|\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)[nlLfFdDmM]?\\b'),
];

const LANGUAGES: Record<CodeLanguage, readonly Rule[]> = {
  plaintext: [],

  typescript: [
    ...C_COMMENTS,
    ['string', sticky('`(?:\\\\[\\s\\S]|[^`\\\\])*(?:`|$)')],
    ...C_STRINGS,
    NUMBER,
    ['constant', words('true false null undefined NaN Infinity')],
    ['type', words('string number boolean any unknown never object symbol bigint void')],
    ['keyword', words(JS_KEYWORDS)],
    ['function', sticky('@[A-Za-z_]\\w*')],
    ...COMMON_TAIL,
  ],

  javascript: [
    ...C_COMMENTS,
    ['string', sticky('`(?:\\\\[\\s\\S]|[^`\\\\])*(?:`|$)')],
    ...C_STRINGS,
    NUMBER,
    ['constant', words('true false null undefined NaN Infinity')],
    ['keyword', words(JS_KEYWORDS)],
    ...COMMON_TAIL,
  ],

  java: [
    ...C_COMMENTS,
    ...C_STRINGS,
    NUMBER,
    ['constant', words('true false null')],
    [
      'keyword',
      words(
        'abstract assert break case catch class const continue default do else enum extends final finally for goto if implements import instanceof interface native new package private protected public return static strictfp super switch synchronized this throw throws transient try void volatile while var record sealed permits',
      ),
    ],
    [
      'type',
      words('int long short byte char float double boolean String Integer Long Double Object List Map Set'),
    ],
    ['function', sticky('@[A-Za-z_]\\w*')],
    ...COMMON_TAIL,
  ],

  csharp: [
    ...C_COMMENTS,
    ['string', sticky('@?"(?:""|\\\\.|[^"\\\\])*(?:"|$)')],
    ['string', sticky("'(?:\\\\.|[^'\\\\\\n])*(?:'|$)", 'm')],
    NUMBER,
    ['constant', words('true false null')],
    [
      'keyword',
      words(
        'abstract as async await base break case catch checked class const continue default delegate do else enum event explicit extern finally fixed for foreach goto if implicit in interface internal is lock namespace new operator out override params private protected public readonly ref return sealed sizeof stackalloc static struct switch this throw try typeof unchecked unsafe using var virtual void volatile while yield record init get set where',
      ),
    ],
    [
      'type',
      words('int uint long ulong short ushort byte sbyte char float double decimal bool string object dynamic'),
    ],
    ...COMMON_TAIL,
  ],

  python: [
    ['comment', sticky('#[^\\n]*')],
    ['string', sticky('[rRbBfFuU]{0,2}"""[\\s\\S]*?(?:"""|$)')],
    ['string', sticky("[rRbBfFuU]{0,2}'''[\\s\\S]*?(?:'''|$)")],
    ['string', sticky('[rRbBfFuU]{0,2}"(?:\\\\.|[^"\\\\\\n])*(?:"|$)', 'm')],
    ['string', sticky("[rRbBfFuU]{0,2}'(?:\\\\.|[^'\\\\\\n])*(?:'|$)", 'm')],
    NUMBER,
    ['constant', words('True False None')],
    [
      'keyword',
      words(
        'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case self cls',
      ),
    ],
    ['function', sticky('@[A-Za-z_][\\w.]*')],
    ...COMMON_TAIL,
  ],

  sql: [
    ['comment', sticky('--[^\\n]*')],
    ['comment', sticky('/\\*[\\s\\S]*?(?:\\*/|$)')],
    ['string', sticky("'(?:''|[^'])*(?:'|$)")],
    ['property', sticky('`[^`\\n]*`')],
    ['property', sticky('"[^"\\n]*"')],
    NUMBER,
    ['constant', words('true false null', 'i')],
    [
      'type',
      words(
        'int integer bigint smallint tinyint serial varchar char text boolean bool date datetime timestamp time decimal numeric float double real json jsonb uuid blob enum',
        'i',
      ),
    ],
    [
      'keyword',
      words(
        'select from where and or not in is like between exists insert into values update set delete create alter drop table index view database schema primary foreign key references unique default check constraint add column cascade restrict join inner left right outer full cross on group by order having limit offset distinct as union all case when then else end asc desc with begin commit rollback truncate auto_increment if returning',
        'i',
      ),
    ],
    ['function', sticky('[A-Za-z_][\\w]*(?=\\s*\\()')],
    ['plain', sticky('[A-Za-z_][\\w]*')],
    ['operator', sticky('[+\\-*/%=<>!|&^~:]+')],
    ['punct', sticky('[()[\\];,.]')],
  ],

  json: [
    ['property', sticky('"(?:\\\\.|[^"\\\\\\n])*"(?=\\s*:)')],
    ['string', sticky('"(?:\\\\.|[^"\\\\\\n])*(?:"|$)', 'm')],
    ['number', sticky('-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?')],
    ['constant', words('true false null')],
    ['punct', sticky('[{}[\\],:]')],
  ],

  html: [
    ['comment', sticky('<!--[\\s\\S]*?(?:-->|$)')],
    ['tag', sticky('</?[A-Za-z][\\w:-]*')],
    ['tag', sticky('/?>')],
    ['string', sticky('"[^"]*(?:"|$)')],
    ['string', sticky("'[^']*(?:'|$)")],
    ['attr', sticky('[A-Za-z_:@][\\w:.-]*(?=\\s*=)')],
    ['operator', sticky('=')],
    ['constant', sticky('&[#\\w]+;')],
  ],

  css: [
    ['comment', sticky('/\\*[\\s\\S]*?(?:\\*/|$)')],
    ['string', sticky('"(?:\\\\.|[^"\\\\\\n])*(?:"|$)', 'm')],
    ['string', sticky("'(?:\\\\.|[^'\\\\\\n])*(?:'|$)", 'm')],
    ['keyword', sticky('@[\\w-]+')],
    ['number', sticky('#[0-9a-fA-F]{3,8}\\b')],
    ['number', sticky('-?(?:\\d+\\.?\\d*|\\.\\d+)(?:px|em|rem|%|vh|vw|vmin|vmax|ch|s|ms|deg|fr)?\\b')],
    ['property', sticky('-{0,2}[a-zA-Z][\\w-]*(?=\\s*:(?!:)[^{};]*[;}])')],
    ['function', sticky('[\\w-]+(?=\\()')],
    ['type', sticky('[.#][\\w-]+')],
    ['plain', sticky('[\\w-]+')],
    ['punct', sticky('[{}()[\\];,:>+~*]')],
  ],

  bash: [
    ['comment', sticky('#[^\\n]*')],
    ['string', sticky('"(?:\\\\.|[^"\\\\])*(?:"|$)')],
    ['string', sticky("'[^']*(?:'|$)")],
    ['variable', sticky('\\$(?:\\{[^}\\n]*\\}|[A-Za-z_]\\w*|[0-9@#?*$!-])')],
    NUMBER,
    [
      'keyword',
      words(
        'if then else elif fi for while until do done case esac in function select time return exit break continue local export readonly declare unset',
      ),
    ],
    [
      'function',
      words(
        'echo cd ls cat grep sed awk find mkdir rm cp mv chmod chown curl wget git npm npx node docker kubectl sudo apt yarn pip python make touch tar ssh scp source printf read test',
      ),
    ],
    ['attr', sticky('--?[A-Za-z][\\w-]*')],
    ['plain', sticky('[\\w./~-]+')],
    ['operator', sticky('[|&;<>=!]+')],
    ['punct', sticky('[(){}[\\]]')],
  ],
};

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
  javascript: 'JavaScript',
  sql: 'SQL',
  json: 'JSON',
  python: 'Python',
  csharp: 'C#',
  java: 'Java',
  html: 'HTML',
  css: 'CSS',
  bash: 'Bash',
};

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
  const rules = LANGUAGES[(language as CodeLanguage) ?? 'plaintext'] ?? LANGUAGES.plaintext;
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
