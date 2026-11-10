import { svgRejectionReason } from './svg-safety';

describe('svgRejectionReason', () => {
  const wrap = (inner: string): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${inner}</svg>`;

  it('accepts plain shapes, gradients and in-document references', () => {
    expect(
      svgRejectionReason(
        wrap(
          '<defs><linearGradient id="g"/></defs><rect width="5" height="5" fill="url(#g)"/><use href="#g"/>',
        ),
      ),
    ).toBeNull();
  });

  it('accepts inline data: images', () => {
    expect(
      svgRejectionReason(wrap('<image href="data:image/png;base64,AAAA" width="2" height="2"/>')),
    ).toBeNull();
  });

  it.each([
    ['script element', wrap('<script>alert(1)</script>')],
    ['foreignObject', wrap('<foreignObject><div/></foreignObject>')],
    ['event handler', wrap('<rect width="1" height="1" onload="x()"/>')],
    ['javascript url', wrap('<a href="javascript:alert(1)"><rect width="1" height="1"/></a>')],
    ['external image', wrap('<image href="https://evil.example/x.png"/>')],
    ['external css url', wrap('<rect style="fill:url(http://evil.example/a)"/>')],
    ['entity declaration', '<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg"/>'],
  ])('rejects %s', (_name, svg) => {
    expect(svgRejectionReason(svg)).not.toBeNull();
  });

  it('rejects documents that are not SVG', () => {
    expect(svgRejectionReason('<html></html>')).not.toBeNull();
  });
});
