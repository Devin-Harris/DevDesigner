const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/** Elements that can run script or embed foreign documents; never needed by built slide SVG. */
const BLOCKED_TAGS = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed']);
/** SMIL elements, which could otherwise animate an href or handler onto a node. */
const ANIMATION_TAGS = new Set(['set', 'animate', 'animatetransform', 'animatemotion']);

/** Same-document fragments, embedded images, or plain http(s) links. */
function isSafeHref(value: string): boolean {
   // Browsers ignore ASCII whitespace/control chars inside schemes ("java\tscript:").
   const v = value.replace(/[\u0000- ]+/g, '').toLowerCase();
   return v.startsWith('#') || v.startsWith('data:image/') || v.startsWith('http://') || v.startsWith('https://');
}

/**
 * Strip anything executable from an SVG DOM tree in place: script / foreignObject (and
 * other embedding) elements, every `on*` attribute, and `href` / `xlink:href` values that
 * aren't a `#fragment`, a `data:image/…` URI or http(s).
 */
export function sanitizeSvgDom(root: Element): void {
   const all = [root, ...Array.from(root.querySelectorAll('*'))];
   for (const el of all) {
      const tag = el.localName.toLowerCase();
      if (BLOCKED_TAGS.has(tag)) {
         el.remove();
         continue;
      }
      if (ANIMATION_TAGS.has(tag)) {
         const target = (el.getAttribute('attributeName') ?? '').toLowerCase();
         if (target.startsWith('on') || target === 'href' || target.endsWith(':href')) {
            el.remove();
            continue;
         }
      }
      for (const a of Array.from(el.attributes)) {
         const name = a.localName.toLowerCase();
         if (name.startsWith('on')) {
            el.removeAttributeNode(a);
         } else if (name === 'href' && !isSafeHref(a.value)) {
            el.removeAttributeNode(a);
         }
      }
   }
}

/**
 * Parse SVG markup inertly (DOMParser documents have no browsing context, so nothing
 * loads or runs) and sanitize it. Returns the root `<svg>`, or null when it doesn't parse.
 */
export function parseSafeSvg(markup: string): SVGSVGElement | null {
   const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
   const root = doc.documentElement;
   if (
      !root ||
      root.localName !== 'svg' ||
      root.namespaceURI !== SVG_NS ||
      root.getElementsByTagName('parsererror').length
   ) {
      return null;
   }
   sanitizeSvgDom(root);
   return root as unknown as SVGSVGElement;
}

/** Sanitized nodes for an SVG fragment (e.g. a DiagramSvg `body`), imported into `document`. */
export function safeSvgFragment(body: string): Node[] {
   const root = parseSafeSvg(`<svg xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}">${body}</svg>`);
   return root ? Array.from(root.childNodes).map((n) => document.importNode(n, true)) : [];
}
