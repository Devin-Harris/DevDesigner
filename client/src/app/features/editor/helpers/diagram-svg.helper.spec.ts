import type { CanvasElementModel, TableModel } from '@devdesigner/shared';
import { buildDiagramSvg } from './diagram-svg.helper';

const PAYLOAD = '"><svg onload=window.__x=1>';

function element(overrides: Partial<CanvasElementModel>): CanvasElementModel {
   return {
      id: 'el-1',
      type: 'rectangle',
      x: 10,
      y: 20,
      width: 120,
      height: 80,
      angle: 0,
      strokeColor: '#131720',
      fillStyle: 'solid',
      strokeWidth: 2,
      strokeStyle: 'solid',
      opacity: 100,
      zIndex: 1,
      ...overrides,
   };
}

function table(overrides: Partial<TableModel>): TableModel {
   return {
      id: 'tbl-1',
      name: 'users',
      x: 300,
      y: 40,
      columns: [
         {
            id: 'col-1',
            name: 'id',
            dataType: { name: 'INT' },
            isPrimaryKey: true,
            isNullable: false,
            isUnique: true,
            isAutoIncrement: true,
         },
      ],
      ...overrides,
   } as TableModel;
}

/** Parse as the morph stage does (XML) and as innerHTML would (HTML), returning both roots. */
function parseBoth(svg: string): { xml: Element; html: Element } {
   const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
   const host = document.createElement('div');
   host.innerHTML = svg;
   return { xml: doc.documentElement, html: host };
}

function expectInert(svg: string): void {
   const { xml, html } = parseBoth(svg);
   expect(xml.getElementsByTagName('parsererror').length).toBe(0);
   for (const root of [xml, html]) {
      const all = [root, ...Array.from(root.querySelectorAll('*'))];
      expect(all.some((el) => el.hasAttribute('onload'))).toBe(false);
      // Only the one root <svg>: the payload must not open a second one.
      expect(root.querySelectorAll('svg svg').length).toBe(0);
   }
   expect((window as unknown as { __x?: number }).__x).toBeUndefined();
}

describe('buildDiagramSvg attribute escaping', () => {
   afterEach(() => {
      delete (window as unknown as { __x?: number }).__x;
   });

   it('keeps a hostile strokeColor inside its attribute (PoC for H-1)', () => {
      const { svg } = buildDiagramSvg([], [], [element({ strokeColor: PAYLOAD })]);
      expect(svg).not.toContain('<svg onload');
      expectInert(svg);
      const { xml } = parseBoth(svg);
      const strokes = Array.from(xml.querySelectorAll('[data-eid="el-1"] [stroke]')).map((el) =>
         el.getAttribute('stroke')
      );
      expect(strokes).toContain(PAYLOAD);
   });

   it('escapes a hostile backgroundColor', () => {
      const { svg } = buildDiagramSvg([], [], [element({ backgroundColor: PAYLOAD })]);
      expectInert(svg);
   });

   it('escapes hostile text and run colors', () => {
      const text = element({
         id: 'txt-1',
         type: 'text',
         text: 'hello world',
         fontSize: 20,
         fontFamily: `Inter"><svg onload=window.__x=1>`,
         strokeColor: PAYLOAD,
         runs: [{ text: 'hello ', color: PAYLOAD }, { text: 'world' }],
      });
      const { svg } = buildDiagramSvg([], [], [text]);
      expectInert(svg);
   });

   it('escapes a hostile table color', () => {
      const { svg } = buildDiagramSvg([table({ color: PAYLOAD })], []);
      expectInert(svg);
   });

   it('escapes hostile sequence diagram colors', () => {
      const { svg } = buildDiagramSvg([], [], [], {
         diagrams: [
            {
               id: 'seq-1',
               title: 'Flow',
               originY: 0,
               headerHeight: 40,
               rowSpacing: 40,
               zIndex: 0,
               backgroundColor: PAYLOAD,
               borderColor: PAYLOAD,
            },
         ] as never,
         lifelines: [
            {
               id: 'll-1',
               diagramId: 'seq-1',
               label: 'A',
               x: 100,
               width: 120,
               color: PAYLOAD,
               lineColor: PAYLOAD,
               strokeColor: PAYLOAD,
               textColor: PAYLOAD,
            },
            { id: 'll-2', diagramId: 'seq-1', label: 'B', x: 300, width: 120 },
         ] as never,
         messages: [
            {
               id: 'm-1',
               diagramId: 'seq-1',
               fromLifelineId: 'll-1',
               toLifelineId: 'll-2',
               label: 'call',
               y: 80,
               direction: 'forward',
               style: 'solid',
               color: PAYLOAD,
            },
         ] as never,
      });
      expectInert(svg);
   });

   it('still renders ordinary colors unchanged', () => {
      const { svg } = buildDiagramSvg([], [], [element({ strokeColor: '#ff0000', backgroundColor: '#00ff00' })]);
      const { xml } = parseBoth(svg);
      const rect = xml.querySelector('[data-eid="el-1"] rect');
      expect(rect?.getAttribute('stroke')).toBe('#ff0000');
   });
});
