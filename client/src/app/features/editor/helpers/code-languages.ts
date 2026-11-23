import type { CodeLanguage } from '@devdesigner/shared';

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

/** Per-language regex rules for the canvas code highlighter (tried in order at each position). */

export type Rule = readonly [TokenKind, RegExp];

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

export const LANGUAGES: Record<CodeLanguage, readonly Rule[]> = {
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

   java: [
      ...C_COMMENTS,
      ...C_STRINGS,
      NUMBER,
      ['constant', words('true false null')],
      [
         'keyword',
         words(
            'abstract assert break case catch class const continue default do else enum extends final finally for goto if implements import instanceof interface native new package private protected public return static strictfp super switch synchronized this throw throws transient try void volatile while var record sealed permits'
         ),
      ],
      ['type', words('int long short byte char float double boolean String Integer Long Double Object List Map Set')],
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
            'abstract as async await base break case catch checked class const continue default delegate do else enum event explicit extern finally fixed for foreach goto if implicit in interface internal is lock namespace new operator out override params private protected public readonly ref return sealed sizeof stackalloc static struct switch this throw try typeof unchecked unsafe using var virtual void volatile while yield record init get set where'
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
            'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case self cls'
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
            'i'
         ),
      ],
      [
         'keyword',
         words(
            'select from where and or not in is like between exists insert into values update set delete create alter drop table index view database schema primary foreign key references unique default check constraint add column cascade restrict join inner left right outer full cross on group by order having limit offset distinct as union all case when then else end asc desc with begin commit rollback truncate auto_increment if returning',
            'i'
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

   // SCSS adds $variables and // line comments to CSS.
   scss: [
      ['comment', sticky('//[^\\n]*')],
      ['constant', sticky('\\$[\\w-]+')],
      ['keyword', sticky('&')],
      // ...then everything CSS has (added below the table).
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
            'if then else elif fi for while until do done case esac in function select time return exit break continue local export readonly declare unset'
         ),
      ],
      [
         'function',
         words(
            'echo cd ls cat grep sed awk find mkdir rm cp mv chmod chown curl wget git npm npx node docker kubectl sudo apt yarn pip python make touch tar ssh scp source printf read test'
         ),
      ],
      ['attr', sticky('--?[A-Za-z][\\w-]*')],
      ['plain', sticky('[\\w./~-]+')],
      ['operator', sticky('[|&;<>=!]+')],
      ['punct', sticky('[(){}[\\]]')],
   ],

   // Filled in below the table (aliases / shared C rules).
   javascript: [],
   c: [],
   cpp: [],

   go: [
      ...C_COMMENTS,
      ['string', sticky('`[^`]*(?:`|$)')],
      ...C_STRINGS,
      NUMBER,
      ['constant', words('true false nil iota')],
      [
         'keyword',
         words(
            'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var'
         ),
      ],
      [
         'type',
         words(
            'bool byte complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint uint8 uint16 uint32 uint64 uintptr any'
         ),
      ],
      ...COMMON_TAIL,
   ],

   rust: [
      ...C_COMMENTS,
      ['string', sticky('r#*"[\\s\\S]*?(?:"#*|$)')],
      ['string', sticky('b?"(?:\\\\.|[^"\\\\])*(?:"|$)')],
      ['string', sticky("b?'(?:\\\\.|[^'\\\\\\n])'")],
      ['attr', sticky("'[A-Za-z_]\\w*")],
      NUMBER,
      ['constant', words('true false None Some Ok Err Self')],
      [
         'keyword',
         words(
            'as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self static struct super trait type unsafe use where while'
         ),
      ],
      [
         'type',
         words('i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str String Vec Option Result Box'),
      ],
      ['function', sticky('[A-Za-z_]\\w*!')],
      ['function', sticky('#!?\\[[^\\]\\n]*\\]')],
      ...COMMON_TAIL,
   ],

   php: [
      ...C_COMMENTS,
      ['comment', sticky('#[^\\n]*')],
      ['tag', sticky('<\\?(?:php)?|\\?>')],
      ...C_STRINGS,
      ['variable', sticky('\\$[A-Za-z_]\\w*')],
      NUMBER,
      ['constant', words('true false null TRUE FALSE NULL')],
      [
         'keyword',
         words(
            'abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile enum extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while yield'
         ),
      ],
      ['type', words('int float string bool void mixed object iterable never self parent')],
      ...COMMON_TAIL,
   ],

   ruby: [
      ['comment', sticky('#[^\\n]*')],
      ...C_STRINGS,
      ['constant', sticky(':[A-Za-z_]\\w*[?!]?')],
      ['variable', sticky('@{1,2}[A-Za-z_]\\w*|\\$[A-Za-z_]\\w*')],
      NUMBER,
      ['constant', words('true false nil self')],
      [
         'keyword',
         words(
            'alias and begin break case class def defined do else elsif end ensure for if in module next not or redo rescue retry return super then undef unless until when while yield require require_relative attr_accessor attr_reader attr_writer private protected public'
         ),
      ],
      ...COMMON_TAIL,
   ],

   kotlin: [
      ...C_COMMENTS,
      ['string', sticky('"""[\\s\\S]*?(?:"""|$)')],
      ...C_STRINGS,
      NUMBER,
      ['constant', words('true false null')],
      [
         'keyword',
         words(
            'abstract as break by catch class companion const constructor continue data do else enum external final finally for fun if import in init inline interface internal is lateinit object open operator out override package private protected public reified return sealed super suspend this throw try typealias val var vararg when where while'
         ),
      ],
      ['function', sticky('@[A-Za-z_]\\w*')],
      ...COMMON_TAIL,
   ],

   swift: [
      ...C_COMMENTS,
      ['string', sticky('"""[\\s\\S]*?(?:"""|$)')],
      ['string', sticky('"(?:\\\\.|[^"\\\\\\n])*(?:"|$)', 'm')],
      NUMBER,
      ['constant', words('true false nil self Self')],
      [
         'keyword',
         words(
            'actor associatedtype async await break case catch class continue default defer deinit do else enum extension fallthrough fileprivate for func guard if import in init inout internal is let mutating open operator private protocol public repeat rethrows return some static struct subscript super switch throw throws try typealias var where while any weak'
         ),
      ],
      ['function', sticky('@[A-Za-z_]\\w*')],
      ...COMMON_TAIL,
   ],

   dart: [
      ...C_COMMENTS,
      ['string', sticky("'''[\\s\\S]*?(?:'''|$)")],
      ['string', sticky('"""[\\s\\S]*?(?:"""|$)')],
      ...C_STRINGS,
      NUMBER,
      ['constant', words('true false null')],
      [
         'keyword',
         words(
            'abstract as assert async await base break case catch class const continue covariant default deferred do dynamic else enum export extends extension external factory final finally for get hide if implements import in interface is late library mixin new on operator part required rethrow return sealed set show static super switch sync this throw try typedef var void when while with yield'
         ),
      ],
      ['type', words('int double num bool String List Map Set Future Stream Object')],
      ['function', sticky('@[A-Za-z_]\\w*')],
      ...COMMON_TAIL,
   ],

   lua: [
      ['comment', sticky('--\\[\\[[\\s\\S]*?(?:\\]\\]|$)')],
      ['comment', sticky('--[^\\n]*')],
      ['string', sticky('\\[\\[[\\s\\S]*?(?:\\]\\]|$)')],
      ...C_STRINGS,
      NUMBER,
      ['constant', words('true false nil')],
      [
         'keyword',
         words('and break do else elseif end for function goto if in local not or repeat return then until while'),
      ],
      ...COMMON_TAIL,
   ],

   powershell: [
      ['comment', sticky('<#[\\s\\S]*?(?:#>|$)')],
      ['comment', sticky('#[^\\n]*')],
      ['string', sticky('"(?:`.|[^"`])*(?:"|$)')],
      ['string', sticky("'(?:''|[^'])*(?:'|$)")],
      ['constant', sticky('\\$(?:true|false|null)\\b', 'i')],
      ['variable', sticky('\\$(?:\\{[^}\\n]*\\}|[A-Za-z_][\\w:]*)')],
      NUMBER,
      [
         'keyword',
         words(
            'begin break catch class continue data do dynamicparam else elseif end enum exit filter finally for foreach from function if in param process return switch throw trap try until using while',
            'i'
         ),
      ],
      ['function', sticky('[A-Za-z]+-[A-Za-z]+')],
      ['attr', sticky('-[A-Za-z]\\w*')],
      ['type', sticky('\\[[A-Za-z][\\w.]*\\]')],
      ...COMMON_TAIL,
   ],

   yaml: [
      ['comment', sticky('#[^\\n]*')],
      ['property', sticky('[A-Za-z_][\\w .-]*(?=\\s*:(?:\\s|$))', 'm')],
      ['property', sticky('"[^"\\n]*"(?=\\s*:(?:\\s|$))', 'm')],
      ...C_STRINGS,
      ['keyword', sticky('---|\\.\\.\\.')],
      ['variable', sticky('[&*][\\w-]+')],
      ['type', sticky('![\\w!/-]*')],
      ['constant', words('true false null yes no on off True False Null')],
      ['number', sticky('-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b')],
      ['punct', sticky('[-:|>{}[\\],?]')],
      ['plain', sticky('[^\\s#:,[\\]{}]+')],
   ],

   xml: [
      ['comment', sticky('<!--[\\s\\S]*?(?:-->|$)')],
      ['keyword', sticky('<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>|$)')],
      ['keyword', sticky('<[?!][\\w-]*|\\?>')],
      ['tag', sticky('</?[A-Za-z_][\\w:.-]*')],
      ['tag', sticky('/?>')],
      ['string', sticky('"[^"]*(?:"|$)')],
      ['string', sticky("'[^']*(?:'|$)")],
      ['attr', sticky('[A-Za-z_:][\\w:.-]*(?=\\s*=)')],
      ['operator', sticky('=')],
      ['constant', sticky('&[#\\w]+;')],
   ],

   markdown: [
      ['comment', sticky('<!--[\\s\\S]*?(?:-->|$)')],
      ['string', sticky('```[\\s\\S]*?(?:```|$)')],
      ['keyword', sticky('^#{1,6}[^\\n]*', 'm')],
      ['punct', sticky('^[ \\t]*(?:[-*+]|\\d+\\.)(?=\\s)', 'm')],
      ['comment', sticky('^>[^\\n]*', 'm')],
      ['string', sticky('`[^`\\n]+`')],
      ['function', sticky('!?\\[[^\\]\\n]*\\]\\([^)\\n]*\\)')],
      ['type', sticky('\\*\\*[^*\\n]+\\*\\*|__[^_\\n]+__')],
      ['attr', sticky('\\*[^*\\n]+\\*|_[^_\\n]+_')],
      ['plain', sticky('[^\\s`#*_[!<>-]+')],
   ],

   dockerfile: [
      ['comment', sticky('#[^\\n]*')],
      [
         'keyword',
         sticky(
            '^[ \\t]*(?:FROM|RUN|CMD|LABEL|MAINTAINER|EXPOSE|ENV|ADD|COPY|ENTRYPOINT|VOLUME|USER|WORKDIR|ARG|ONBUILD|STOPSIGNAL|HEALTHCHECK|SHELL)\\b',
            'im'
         ),
      ],
      ['keyword', words('AS', 'i')],
      ...C_STRINGS,
      ['variable', sticky('\\$(?:\\{[^}\\n]*\\}|[A-Za-z_]\\w*)')],
      ['attr', sticky('--?[A-Za-z][\\w-]*')],
      NUMBER,
      ['plain', sticky('[\\w./~:@-]+')],
      ['operator', sticky('[|&;<>=!\\\\]+')],
      ['punct', sticky('[(){}[\\],]')],
   ],

   graphql: [
      ['comment', sticky('#[^\\n]*')],
      ['string', sticky('"""[\\s\\S]*?(?:"""|$)')],
      ['string', sticky('"(?:\\\\.|[^"\\\\\\n])*(?:"|$)', 'm')],
      ['variable', sticky('\\$[A-Za-z_]\\w*')],
      ['function', sticky('@[A-Za-z_]\\w*')],
      NUMBER,
      ['constant', words('true false null')],
      [
         'keyword',
         words(
            'query mutation subscription fragment on type input enum interface union scalar schema extend directive implements repeatable'
         ),
      ],
      ['type', words('Int Float String Boolean ID')],
      ['property', sticky('[A-Za-z_]\\w*(?=\\s*[:(])')],
      ...COMMON_TAIL,
   ],
};
LANGUAGES.scss = [...LANGUAGES.scss, ...LANGUAGES.css];
LANGUAGES.javascript = LANGUAGES.typescript;

const C_PREPROCESSOR: Rule = ['function', sticky('#[ \\t]*\\w+(?:[ \\t]*<[^>\\n]*>)?')];
const C_KEYWORDS =
   'auto break case const continue default do else enum extern for goto if inline register restrict return sizeof static struct switch typedef union volatile while';
const C_TYPES =
   'void char short int long float double signed unsigned bool size_t int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t';
LANGUAGES.c = [
   C_PREPROCESSOR,
   ...C_COMMENTS,
   ...C_STRINGS,
   NUMBER,
   ['constant', words('true false NULL nullptr')],
   ['type', words(C_TYPES)],
   ['keyword', words(C_KEYWORDS)],
   ...COMMON_TAIL,
];
LANGUAGES.cpp = [
   C_PREPROCESSOR,
   ...C_COMMENTS,
   ['string', sticky('R"\\([\\s\\S]*?(?:\\)"|$)')],
   ...C_STRINGS,
   NUMBER,
   ['constant', words('true false NULL nullptr this')],
   ['type', words(`${C_TYPES} wchar_t char8_t char16_t char32_t string vector map`)],
   [
      'keyword',
      words(
         `${C_KEYWORDS} alignas alignof catch class concept consteval constexpr constinit co_await co_return co_yield decltype delete explicit export final friend mutable namespace new noexcept operator override private protected public requires static_assert static_cast dynamic_cast reinterpret_cast const_cast template throw try typename using virtual`
      ),
   ],
   ...COMMON_TAIL,
];
