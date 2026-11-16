/**
 * Allow-list SVG sanitizer (security L-5 / S4.4), replacing the old regex blocklist.
 *
 * The document is tokenized, entity references in attribute values are DECODED
 * before any check (so `href="&#106;avascript:..."` is seen as `javascript:`), and a
 * new document is serialized from what survives:
 *  - elements: only the allow-listed SVG drawing elements below. Anything else
 *    (`script`, `foreignObject`, `iframe`, editor namespaces, ...) is dropped WITH its
 *    content; `<a>` is unwrapped (its children kept, the link dropped).
 *  - attributes: only the allow-listed names below; no event handlers, no foreign
 *    namespaces. `href` / `xlink:href` may only be an in-document `#id` or an inline
 *    raster `data:image/...;base64,` URL. Any `url(...)` must be `url(#id)`.
 *  - `style` attributes and `<style>` text must be plain CSS: no backslash escapes,
 *    `@import`, `expression(`, `javascript:` or non-fragment `url(...)`; otherwise
 *    the attribute (or the whole `<style>` element) is dropped.
 *  - comments, processing instructions and CDATA outside `<style>` are dropped; a
 *    DOCTYPE or ENTITY declaration rejects the document.
 *
 * Images are additionally only ever shown through `<img>`/`<image>` (no script) and
 * served with a sandbox CSP; this keeps a stored file harmless wherever it ends up.
 */

export class SvgRejectedError extends Error {}

const ELEMENTS = new Set([
  'svg', 'g', 'defs', 'symbol', 'use', 'title', 'desc', 'switch',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textPath',
  'linearGradient', 'radialGradient', 'stop', 'pattern', 'clipPath', 'mask', 'marker', 'image', 'style',
  'filter', 'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite', 'feConvolveMatrix',
  'feDiffuseLighting', 'feDisplacementMap', 'feDistantLight', 'feDropShadow', 'feFlood', 'feFuncA', 'feFuncB',
  'feFuncG', 'feFuncR', 'feGaussianBlur', 'feMerge', 'feMergeNode', 'feMorphology', 'feOffset', 'fePointLight',
  'feSpecularLighting', 'feSpotLight', 'feTile', 'feTurbulence',
]);

/** Elements removed but whose children are kept. */
const UNWRAP = new Set(['a']);

const ATTRIBUTES = new Set([
  // core / structure
  'id', 'class', 'style', 'lang', 'xml:lang', 'xml:space', 'tabindex', 'role', 'aria-label', 'aria-hidden',
  'version', 'baseProfile', 'width', 'height', 'x', 'y', 'viewBox', 'preserveAspectRatio', 'transform',
  'href', 'xlink:href', 'xlink:title', 'xmlns', 'xmlns:xlink', 'xmlns:svg',
  // geometry
  'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'points', 'pathLength',
  'dx', 'dy', 'rotate', 'textLength', 'lengthAdjust', 'startOffset', 'method', 'spacing', 'side',
  // presentation
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap',
  'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'color',
  'display', 'visibility', 'overflow', 'clip', 'clip-path', 'clip-rule', 'mask', 'filter', 'marker-start',
  'marker-mid', 'marker-end', 'paint-order', 'vector-effect', 'shape-rendering', 'text-rendering',
  'image-rendering', 'color-interpolation', 'color-interpolation-filters', 'mix-blend-mode', 'isolation',
  'font-family', 'font-size', 'font-size-adjust', 'font-stretch', 'font-style', 'font-variant', 'font-weight',
  'letter-spacing', 'word-spacing', 'text-anchor', 'text-decoration', 'dominant-baseline', 'alignment-baseline',
  'baseline-shift', 'writing-mode', 'direction', 'unicode-bidi', 'white-space',
  'stop-color', 'stop-opacity', 'flood-color', 'flood-opacity', 'lighting-color',
  // paint servers, markers, clipping
  'offset', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'fx', 'fy', 'fr', 'patternUnits',
  'patternContentUnits', 'patternTransform', 'clipPathUnits', 'maskUnits', 'maskContentUnits', 'markerUnits',
  'markerWidth', 'markerHeight', 'refX', 'refY', 'orient',
  // filters
  'filterUnits', 'primitiveUnits', 'in', 'in2', 'result', 'stdDeviation', 'edgeMode', 'mode', 'type', 'values',
  'operator', 'k1', 'k2', 'k3', 'k4', 'scale', 'xChannelSelector', 'yChannelSelector', 'radius',
  'baseFrequency', 'numOctaves', 'seed', 'stitchTiles', 'tableValues', 'slope', 'intercept', 'amplitude',
  'exponent', 'order', 'kernelMatrix', 'divisor', 'bias', 'targetX', 'targetY', 'preserveAlpha',
  'surfaceScale', 'diffuseConstant', 'specularConstant', 'specularExponent', 'kernelUnitLength', 'azimuth',
  'elevation', 'z', 'pointsAtX', 'pointsAtY', 'pointsAtZ', 'limitingConeAngle',
  // style element
  'media',
]);

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const NS_VALUES: Record<string, string> = { xmlns: SVG_NS, 'xmlns:svg': SVG_NS, 'xmlns:xlink': XLINK_NS };

const SAFE_DATA_URL = /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]*$/i;

/** Plain CSS only: no escapes, imports, script URLs, legacy IE hooks or external url()s. */
export function cssIsSafe(css: string): boolean {
  if (/[\\]|@import|expression\s*\(|javascript\s*:|vbscript\s*:|behavior\s*:|-moz-binding/i.test(css)) return false;
  return !/url\s*\(\s*(?!['"]?\s*#)/i.test(css);
}

function urlRefsAreLocal(value: string): boolean {
  return !/url\s*\(\s*(?!['"]?\s*#)/i.test(value);
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Decode XML character and predefined entity references; unknown ones reject the document. */
export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);?/gi, (match, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) throw new SvgRejectedError('contains an invalid character reference');
      return String.fromCodePoint(code);
    }
    const named = NAMED[ref.toLowerCase()];
    if (named === undefined || !match.endsWith(';')) throw new SvgRejectedError('uses an undeclared entity');
    return named;
  });
}

const escapeAttr = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escapeText = (v: string): string => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Keep an attribute? Returns the decoded value to write, or null to drop it. */
function cleanAttribute(element: string, name: string, raw: string): string | null {
  if (!ATTRIBUTES.has(name)) return null;
  const value = decodeEntities(raw);
  // Control characters are how scheme checks get dodged ("java\tscript:").
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point here
  const compact = value.replace(/[\u0000- \u007f-\u009f]+/g, '');
  if (name in NS_VALUES) return value.trim() === NS_VALUES[name] ? value.trim() : null;
  if (name === 'href' || name === 'xlink:href') {
    if (compact.startsWith('#')) return value.trim();
    if (element === 'image' && SAFE_DATA_URL.test(value.trim())) return value.trim();
    return null;
  }
  if (name === 'style') return cssIsSafe(value) ? value : null;
  if (/javascript:|vbscript:|data:/i.test(compact)) return null;
  if (!urlRefsAreLocal(value)) return null;
  return value;
}

interface Tag {
  name: string;
  attrs: Array<[string, string]>;
  selfClosing: boolean;
}

const NAME = /[A-Za-z_][\w.:-]*/y;

function parseTag(src: string, start: number): { tag: Tag; end: number } {
  // `start` points just past '<'.
  NAME.lastIndex = start;
  const m = NAME.exec(src);
  if (!m) throw new SvgRejectedError('is not well-formed');
  const tag: Tag = { name: m[0], attrs: [], selfClosing: false };
  let i = NAME.lastIndex;
  for (;;) {
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src.startsWith('/>', i)) return { tag: { ...tag, selfClosing: true }, end: i + 2 };
    if (src[i] === '>') return { tag, end: i + 1 };
    NAME.lastIndex = i;
    const a = NAME.exec(src);
    if (!a) throw new SvgRejectedError('is not well-formed');
    i = NAME.lastIndex;
    while (/\s/.test(src[i] ?? '')) i++;
    if (src[i] !== '=') throw new SvgRejectedError('is not well-formed');
    i++;
    while (/\s/.test(src[i] ?? '')) i++;
    const quote = src[i];
    if (quote !== '"' && quote !== "'") throw new SvgRejectedError('is not well-formed');
    const close = src.indexOf(quote, i + 1);
    if (close === -1) throw new SvgRejectedError('is not well-formed');
    const value = src.slice(i + 1, close);
    if (value.includes('<')) throw new SvgRejectedError('is not well-formed');
    tag.attrs.push([a[0], value]);
    i = close + 1;
  }
}

/**
 * Sanitize an SVG document. Returns the cleaned markup; throws SvgRejectedError when
 * the input is not an SVG document at all or uses DTD features.
 */
export function sanitizeSvg(input: string): string {
  const src = input.replace(/^\uFEFF/, ''); // byte-order mark
  if (/<!DOCTYPE|<!ENTITY/i.test(src)) throw new SvgRejectedError('declares a DTD or XML entity');
  let out = '';
  let i = 0;
  let rootSeen = false;
  /** Open elements: name, and whether it is written to the output. */
  const stack: Array<{ name: string; kept: boolean; unwrap: boolean }> = [];
  const dropping = (): boolean => stack.some((s) => !s.kept && !s.unwrap);
  const inStyle = (): boolean => stack.length > 0 && /^(svg:)?style$/.test(stack[stack.length - 1].name);
  let styleText = '';

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    const text = src.slice(i, lt === -1 ? src.length : lt);
    if (text) {
      if (inStyle()) styleText += decodeEntities(text);
      else if (!dropping() && stack.length) out += escapeText(decodeEntities(text));
    }
    if (lt === -1) break;
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      if (end === -1) throw new SvgRejectedError('is not well-formed');
      i = end + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9);
      if (end === -1) throw new SvgRejectedError('is not well-formed');
      if (inStyle()) styleText += src.slice(lt + 9, end);
      else if (!dropping() && stack.length) out += escapeText(src.slice(lt + 9, end));
      i = end + 3;
      continue;
    }
    if (src.startsWith('<?', lt)) {
      const end = src.indexOf('?>', lt + 2);
      if (end === -1) throw new SvgRejectedError('is not well-formed');
      i = end + 2;
      continue;
    }
    if (src.startsWith('<!', lt)) throw new SvgRejectedError('contains a markup declaration');
    if (src[lt + 1] === '/') {
      const end = src.indexOf('>', lt);
      if (end === -1) throw new SvgRejectedError('is not well-formed');
      const name = src.slice(lt + 2, end).trim();
      const open = stack.pop();
      if (!open || open.name !== name) throw new SvgRejectedError('is not well-formed');
      const local = open.name.startsWith('svg:') ? open.name.slice(4) : open.name;
      if (open.kept) {
        // A style sheet is kept whole or emptied: never partially.
        if (local === 'style') out += cssIsSafe(styleText) ? escapeText(styleText) : '';
        out += `</${local}>`;
      }
      if (local === 'style') styleText = '';
      i = end + 1;
      continue;
    }
    const { tag, end } = parseTag(src, lt + 1);
    i = end;
    if (!rootSeen) {
      if (tag.name !== 'svg' && tag.name !== 'svg:svg') throw new SvgRejectedError('is not an SVG document');
      rootSeen = true;
    } else if (stack.length === 0) {
      throw new SvgRejectedError('has content after the root element');
    }
    const local = tag.name.startsWith('svg:') ? tag.name.slice(4) : tag.name;
    const kept = !dropping() && ELEMENTS.has(local) && (local !== 'style' || !inStyle());
    const unwrap = !kept && !dropping() && UNWRAP.has(local);
    if (kept) {
      let attrs = '';
      for (const [name, value] of tag.attrs) {
        const clean = cleanAttribute(local, name, value);
        if (clean !== null) attrs += ` ${name}="${escapeAttr(clean)}"`;
      }
      if (local === 'svg' && stack.length === 0 && !tag.attrs.some(([n]) => n === 'xmlns')) {
        attrs = ` xmlns="${SVG_NS}"` + attrs;
      }
      out += `<${local}${attrs}${tag.selfClosing ? '/>' : '>'}`;
    }
    if (!tag.selfClosing) stack.push({ name: tag.name, kept, unwrap });
  }
  if (!rootSeen) throw new SvgRejectedError('is not an SVG document');
  if (stack.length) throw new SvgRejectedError('is not well-formed');
  return out;
}
