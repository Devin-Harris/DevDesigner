import { parseSafeSvg, safeSvgFragment, sanitizeSvgDom } from './svg-sanitize.helper';

const NS = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"';

function parse(markup: string): Element {
  return new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement;
}

describe('sanitizeSvgDom', () => {
  it('removes script and foreignObject elements', () => {
    const root = parse(
      `<svg ${NS}><script>window.__x=1</script><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject><rect width="1" height="1" /></svg>`,
    );
    sanitizeSvgDom(root);
    expect(root.getElementsByTagName('script').length).toBe(0);
    expect(root.getElementsByTagName('foreignObject').length).toBe(0);
    expect(root.getElementsByTagName('rect').length).toBe(1);
  });

  it('strips every on* attribute, including on the root', () => {
    const root = parse(`<svg ${NS} onload="a()"><g onclick="b()"><rect onmouseover="c()" fill="red" /></g></svg>`);
    sanitizeSvgDom(root);
    for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
      expect(Array.from(el.attributes).some((a) => a.name.toLowerCase().startsWith('on'))).toBe(false);
    }
    expect(root.querySelector('rect')?.getAttribute('fill')).toBe('red');
  });

  it('drops unsafe hrefs and keeps fragment, data:image and http(s) ones', () => {
    const root = parse(
      `<svg ${NS}>` +
        `<a id="js" href="javascript:alert(1)"><text>x</text></a>` +
        `<a id="jsx" xlink:href="java&#9;script:alert(1)"><text>x</text></a>` +
        `<image id="html" href="data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;" />` +
        `<use id="frag" href="#shape" />` +
        `<image id="png" href="data:image/png;base64,AAAA" />` +
        `<image id="web" xlink:href="https://example.com/a.png" />` +
        `</svg>`,
    );
    sanitizeSvgDom(root);
    const href = (id: string): string | null => {
      const el = root.querySelector(`#${id}`)!;
      return el.getAttribute('href') ?? el.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    };
    expect(href('js')).toBeNull();
    expect(href('jsx')).toBeNull();
    expect(href('html')).toBeNull();
    expect(href('frag')).toBe('#shape');
    expect(href('png')).toBe('data:image/png;base64,AAAA');
    expect(href('web')).toBe('https://example.com/a.png');
  });

  it('removes SMIL elements that animate an href or handler', () => {
    const root = parse(
      `<svg ${NS}><a href="#x"><set attributeName="href" to="javascript:alert(1)" /><animate attributeName="opacity" from="0" to="1" /></a></svg>`,
    );
    sanitizeSvgDom(root);
    expect(root.getElementsByTagName('set').length).toBe(0);
    expect(root.getElementsByTagName('animate').length).toBe(1);
  });
});

describe('parseSafeSvg / safeSvgFragment', () => {
  it('returns null for markup that does not parse as SVG', () => {
    expect(parseSafeSvg('<svg><unclosed></svg>')).toBeNull();
    expect(parseSafeSvg('<html></html>')).toBeNull();
  });

  it('returns a sanitized svg root', () => {
    const svg = parseSafeSvg(`<svg ${NS} onload="x()"><rect width="2" height="2" /></svg>`);
    expect(svg).not.toBeNull();
    expect(svg!.hasAttribute('onload')).toBe(false);
  });

  it('turns a body fragment into sanitized nodes owned by the document', () => {
    const nodes = safeSvgFragment('<g data-eid="a"><rect onload="x()" /></g><script>x()</script>');
    expect(nodes.length).toBe(1);
    const g = nodes[0] as Element;
    expect(g.ownerDocument).toBe(document);
    expect(g.querySelector('rect')?.hasAttribute('onload')).toBe(false);
  });
});
