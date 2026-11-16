/**
 * Embed the app's web fonts into an exported SVG. An SVG rasterized through an
 * <img> (PNG/PDF) or opened standalone cannot see the page's fonts, so text would
 * fall back to a system font. We read the Google Fonts stylesheets the page
 * already loads (see index.html), inline the latin @font-face files as data URIs,
 * and prepend only the faces whose family the SVG actually uses.
 */

interface FontFace {
   family: string;
   /** Full @font-face rule with its src url() replaced by a data URI. */
   css: string;
}

let facesPromise: Promise<FontFace[]> | null = null;

function toDataUri(blob: Blob): Promise<string> {
   return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
   });
}

async function loadSheet(href: string): Promise<FontFace[]> {
   const css = await (await fetch(href)).text();
   // Google splits each family by unicode-range, labelled with a "/* latin */" comment.
   const blocks = [...css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*(@font-face\s*\{[^}]*\})/g)];
   const wanted = blocks.filter((b) => b[1] === 'latin');
   const faces = await Promise.all(
      wanted.map(async ([, , rule]): Promise<FontFace | null> => {
         const family = /font-family:\s*['"]?([^;'"]+)['"]?/.exec(rule)?.[1]?.trim();
         const url = /url\(([^)]+)\)/.exec(rule)?.[1]?.replace(/['"]/g, '');
         if (!family || !url) {
            return null;
         }
         const data = await toDataUri(await (await fetch(url)).blob());
         return { family, css: rule.replace(/url\([^)]+\)/, `url(${data})`) };
      })
   );
   return faces.filter((f): f is FontFace => f !== null);
}

function loadFaces(): Promise<FontFace[]> {
   if (!facesPromise) {
      const hrefs = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')]
         .map((l) => l.href)
         .filter((h) => h.startsWith('https://fonts.googleapis.com/'));
      facesPromise = Promise.all(hrefs.map((h) => loadSheet(h).catch(() => [] as FontFace[]))).then((all) =>
         all.flat()
      );
      // Don't cache an empty result (e.g. offline) so a later export can retry.
      void facesPromise.then((f) => {
         if (f.length === 0) {
            facesPromise = null;
         }
      });
   }
   return facesPromise;
}

/** Return the SVG with the @font-face rules for the fonts it uses embedded. */
export async function embedFonts(svg: string): Promise<string> {
   try {
      const faces = (await loadFaces()).filter((f) => svg.includes(f.family));
      // Same text shaping as inline SVG (styles.scss): an <img> slide picture gets none of
      // the page CSS, so its titles kerned/hinted differently and visibly shifted the
      // moment a morph (inline, glyph by glyph) took over.
      const shaping = 'text{text-rendering:geometricPrecision;font-kerning:normal}';
      const style = `<style>${shaping}\n${faces.map((f) => f.css).join('\n')}</style>`;
      return svg.replace('<defs>', `<defs>${style}`);
   } catch {
      return svg;
   }
}
