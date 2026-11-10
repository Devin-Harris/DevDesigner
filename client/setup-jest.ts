import { setupZonelessTestEnv } from 'jest-preset-angular/setup-env/zoneless';

setupZonelessTestEnv({
   errorOnUnknownElements: true,
   errorOnUnknownProperties: true,
});

// --- jsdom shims (tests.md). Don't re-mock these in specs. ---------------------------------------

if (!window.matchMedia) {
   Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string): MediaQueryList =>
         ({
            matches: false,
            media: query,
            onchange: null,
            addListener: () => undefined,
            removeListener: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            dispatchEvent: () => false,
         }) as MediaQueryList,
   });
}

class ResizeObserverStub {
   observe(): void {}
   unobserve(): void {}
   disconnect(): void {}
}
if (!('ResizeObserver' in globalThis)) {
   Object.defineProperty(globalThis, 'ResizeObserver', { writable: true, value: ResizeObserverStub });
}

if (typeof globalThis.structuredClone !== 'function') {
   globalThis.structuredClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
}

if (!Element.prototype.scrollIntoView) {
   Element.prototype.scrollIntoView = () => undefined;
}

// jsdom's getComputedStyle throws on pseudo-elements; ignore the second argument.
const jsdomGetComputedStyle = window.getComputedStyle.bind(window);
window.getComputedStyle = (elt: Element) => jsdomGetComputedStyle(elt);

// Canvas helpers touch SVG geometry APIs jsdom doesn't implement.
if (!('DOMMatrix' in globalThis)) {
   class DOMMatrixStub {
      a = 1;
      b = 0;
      c = 0;
      d = 1;
      e = 0;
      f = 0;
      multiply(): DOMMatrixStub {
         return this;
      }
      inverse(): DOMMatrixStub {
         return this;
      }
      translate(): DOMMatrixStub {
         return this;
      }
      scale(): DOMMatrixStub {
         return this;
      }
   }
   Object.defineProperty(globalThis, 'DOMMatrix', { writable: true, value: DOMMatrixStub });
}
const svgProto = (globalThis as { SVGElement?: { prototype: object } }).SVGElement?.prototype as
   (SVGElement & { getBBox?: () => DOMRect }) | undefined;
if (svgProto && !svgProto.getBBox) {
   svgProto.getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 }) as DOMRect;
}

// jsdom logs "Not implemented: HTMLCanvasElement.prototype.getContext"; return null quietly instead,
// which the text-metrics helpers already treat as "no canvas available".
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
