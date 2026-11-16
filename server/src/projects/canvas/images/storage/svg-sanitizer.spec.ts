import { sanitizeSvg, SvgRejectedError } from './svg-sanitizer';

const wrap = (inner: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${inner}</svg>`;

describe('sanitizeSvg (allow-list)', () => {
  it('keeps plain drawings, gradients, in-document references and text', () => {
    const svg = wrap(
      '<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs>' +
        '<rect width="5" height="5" fill="url(#g)"/><use href="#g"/><text x="1" y="2">a &amp; b</text>',
    );
    expect(sanitizeSvg(svg)).toBe(svg);
  });

  it('keeps inline raster data: images', () => {
    const svg = wrap('<image href="data:image/png;base64,AAAA" width="2" height="2"/>');
    expect(sanitizeSvg(svg)).toBe(svg);
  });

  it.each([
    ['script element', wrap('<script>alert(1)</script><rect/>')],
    ['foreignObject', wrap('<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject><rect/>')],
    ['iframe', wrap('<iframe src="https://evil.example"/><rect/>')],
  ])('drops a %s with its content', (_n, svg) => {
    const out = sanitizeSvg(svg);
    expect(out).toBe(wrap('<rect/>'));
  });

  it('drops event handlers and unknown attributes', () => {
    expect(sanitizeSvg(wrap('<rect width="1" onload="x()" onclick="y()" data-x="1"/>'))).toBe(wrap('<rect width="1"/>'));
  });

  it('drops javascript: links, including entity-encoded and whitespace-split ones', () => {
    for (const href of ['javascript:alert(1)', '&#106;avascript:alert(1)', '&#x6A;avascript:x', 'java&#9;script:x', ' javascript:x']) {
      const out = sanitizeSvg(wrap(`<a href="${href}"><rect/></a><use href="${href}"/>`));
      expect(out).toBe(wrap('<rect/><use/>'));
      expect(out.toLowerCase()).not.toContain('script');
    }
  });

  it('drops external references', () => {
    expect(sanitizeSvg(wrap('<image href="https://evil.example/x.png"/>'))).toBe(wrap('<image/>'));
    expect(sanitizeSvg(wrap('<image xlink:href="data:image/svg+xml;base64,AAAA"/>'))).toBe(wrap('<image/>'));
    expect(sanitizeSvg(wrap('<rect style="fill:url(http://evil.example/a)"/>'))).toBe(wrap('<rect/>'));
    expect(sanitizeSvg(wrap('<rect fill="url(https://evil.example/a)"/>'))).toBe(wrap('<rect/>'));
    expect(sanitizeSvg(wrap('<rect style="fill:\\75 rl(http://x)"/>'))).toBe(wrap('<rect/>'));
  });

  it('keeps safe style sheets and empties unsafe ones', () => {
    expect(sanitizeSvg(wrap('<style>.a{fill:red}</style>'))).toBe(wrap('<style>.a{fill:red}</style>'));
    expect(sanitizeSvg(wrap('<style><![CDATA[@import url(https://evil.example/x.css);]]></style>'))).toBe(
      wrap('<style></style>'),
    );
  });

  it('drops editor namespaces and comments', () => {
    const out = sanitizeSvg(
      '<?xml version="1.0"?><!-- made by x --><svg xmlns="http://www.w3.org/2000/svg" xmlns:sodipodi="http://x" ' +
        'sodipodi:docname="a"><sodipodi:namedview id="n"><inner/></sodipodi:namedview><rect/></svg>',
    );
    expect(out).toBe('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
  });

  it.each([
    ['DOCTYPE / entities', '<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>'],
    ['not SVG', '<html><body/></html>'],
    ['undeclared entity', wrap('<text>&nbsp;</text>')],
    ['broken markup', wrap('<rect>')],
    ['two roots', `${wrap('')}<svg/>`],
  ])('rejects %s', (_n, svg) => {
    expect(() => sanitizeSvg(svg)).toThrow(SvgRejectedError);
  });

  it('re-escapes what it decoded, so output never reopens markup', () => {
    const out = sanitizeSvg(wrap('<text x="1">&lt;script&gt;alert(1)&lt;/script&gt;</text>'));
    expect(out).toBe(wrap('<text x="1">&lt;script&gt;alert(1)&lt;/script&gt;</text>'));
  });
});
