/* eslint-disable @typescript-eslint/consistent-type-assertions -- the scripted showcase builds partial rows and mutations by hand */
import type { CanvasElementModel, SchemaModel, SequenceMessageModel, TableModel } from '@devdesigner/shared';
import { columnAnchor } from '../../../../editor';
import type { StepContext } from './showcase-step-context';

/** Showcase steps that build canvas content: pen, text, code, arrows, tables, sequences. */
export function createCanvasSteps(ctx: StepContext) {
   const { cursor, hooks, apply, wait, point, update, boxOf, typeChars, full, snap } = ctx;
   // ---- steps ----

   /** Freehand: the stroke grows point by point under the cursor. */
   async function drawPen(el: CanvasElementModel): Promise<void> {
      const pts = el.points ?? [];
      if (pts.length < 2) {
         apply({ kind: 'element.created', element: el });
         return;
      }
      await point(el.x + pts[0].x, el.y + pts[0].y, 'Pen', 380);
      apply({ kind: 'element.created', element: { ...el, points: pts.slice(0, 2) } });
      const per = Math.max(1, Math.ceil(pts.length / 30));
      for (let i = 2; i <= pts.length; i += per) {
         const end = Math.min(i, pts.length);
         apply({ kind: 'element.updated', element: { ...el, points: pts.slice(0, end) } });
         const p = pts[end - 1];
         cursor({ x: el.x + p.x, y: el.y + p.y });
         await wait(26);
      }
      apply({ kind: 'element.updated', element: el });
      await wait(200);
   }

   /**
    * Resize a text box by its corner handle: the text scales with it (fit-to-glyph text),
    * then it is moved into place. The cursor stays on the handle the whole time.
    */
   async function shrinkText(from: CanvasElementModel, to: CanvasElementModel): Promise<void> {
      const glyphW = (e: CanvasElementModel, fs: number) => Math.min(e.width, (e.text ?? '').length * fs * 0.55);
      const corner = (x: number, y: number, fs: number, h: number) => ({ x: x + glyphW(from, fs), y: y + h });
      const c0 = corner(from.x, from.y, from.fontSize!, from.height);
      await point(from.x + glyphW(from, from.fontSize!) / 2, from.y + from.height / 2, 'Select', 380);
      const sel = (x: number, y: number, fs: number, h: number) => ({ x, y, w: glyphW(from, fs), h });
      cursor({ ...c0, label: 'Resize', box: sel(from.x, from.y, from.fontSize!, from.height) });
      await wait(450);
      // 1. Drag the corner in: the text shrinks, top-left fixed.
      const steps = 14;
      let fs = from.fontSize!;
      let h = from.height;
      for (let s = 1; s <= steps; s++) {
         const k = 1 - Math.pow(1 - s / steps, 2);
         fs = from.fontSize! + (to.fontSize! - from.fontSize!) * k;
         h = from.height + (to.height - from.height) * k;
         apply({
            kind: 'element.updated',
            element: { ...to, x: from.x, y: from.y, fontSize: fs, height: h } as CanvasElementModel,
         });
         cursor({ ...corner(from.x, from.y, fs, h), label: 'Resize', box: sel(from.x, from.y, fs, h) });
         await wait(30);
      }
      await wait(250);
      // 2. Move it into place.
      if (to.x !== from.x || to.y !== from.y) {
         const grab = { x: from.x + glyphW(from, fs) / 2, y: from.y + h / 2 };
         cursor({ ...grab, box: sel(from.x, from.y, fs, h) });
         await wait(200);
         for (let s = 1; s <= 8; s++) {
            const k = 1 - Math.pow(1 - s / 8, 3);
            const x = from.x + (to.x - from.x) * k;
            const y = from.y + (to.y - from.y) * k;
            apply({ kind: 'element.updated', element: { ...to, x, y } as CanvasElementModel });
            cursor({ x: x + glyphW(from, fs) / 2, y: y + h / 2, box: sel(x, y, fs, h) });
            await wait(22);
         }
      }
      apply({ kind: 'element.updated', element: to });
      await wait(150);
   }

   /** A dashed line from `a` that follows the cursor to `b`, removed at the end. */
   async function dragGuide(
      a: { x: number; y: number },
      b: { x: number; y: number },
      key: string,
      steps: number,
      label?: string
   ): Promise<void> {
      let guide = {
         id: `showcase-guide-${key}`,
         type: 'line',
         x: a.x,
         y: a.y,
         width: 0,
         height: 0,
         angle: 0,
         points: [
            { x: 0, y: 0 },
            { x: 0, y: 0 },
         ],
         strokeColor: '#7c5cff',
         fillStyle: 'none',
         strokeWidth: 2,
         strokeStyle: 'dashed',
         opacity: 100,
         zIndex: 9999,
      } as unknown as CanvasElementModel;
      apply({ kind: 'element.created', element: guide });
      for (let i = 1; i <= steps; i++) {
         const k = 1 - Math.pow(1 - i / steps, 2);
         const p = { x: (b.x - a.x) * k, y: (b.y - a.y) * k };
         guide = update(guide, { points: [{ x: 0, y: 0 }, p], width: Math.abs(p.x), height: Math.abs(p.y) });
         cursor({ x: a.x + p.x, y: a.y + p.y, label });
         await wait(30);
      }
      await wait(120);
      apply({ kind: 'element.deleted', elementId: guide.id });
   }

   /**
    * Code: a wide block on top and two half-width blocks under it. The bottom pair
    * starts stretched to the top block's width, then "Fit to content" shrinks each
    * to its code — the right one keeps its right edge on the top block's.
    */
   async function buildCodeTrio(codes: CanvasElementModel[]): Promise<void> {
      const [top, left, right] = codes;
      const gap = 40;
      const y = top.y + top.height + gap;
      const half = (top.width - gap) / 2;
      const tall = Math.max(left.height, right.height) + 36;
      const fitL = { ...left, x: top.x, y };
      const fitR = { ...right, x: top.x + top.width - right.width, y };
      const startL = { ...fitL, width: half, height: tall };
      const startR = { ...fitR, x: top.x + top.width - half, width: half, height: tall };
      await hooks.frame?.({ x: top.x - 20, y: top.y - 20, w: top.width + 40, h: y + tall - top.y + 40 });
      await typeCode(top);

      // Left: typed as one messy line (the block widens to keep it in view)...
      const formatted = left.text ?? '';
      const messy = formatted.replace(/\s*\n\s*/g, ' ').toLowerCase();
      const view = { x: top.x - 20, y: top.y - 20, w: top.width + 40, h: y + tall - top.y + 40 };
      const needL = 44 + messy.length * (left.fontSize ?? 14) * 0.6 + 24;
      await hooks.frame?.({ ...view, w: Math.max(top.width, needL) + 40 });
      let cur = await typeCode({ ...startL, text: messy }, null);
      // ...then dragged back to the width we want...
      await point(cur.x + cur.width, cur.y + cur.height / 2, 'Resize', 450);
      const wide = cur.width;
      for (let i = 1; i <= 12; i++) {
         const w = wide + (half - wide) * (1 - Math.pow(1 - i / 12, 3));
         cur = update(cur, { width: w });
         cursor({ x: cur.x + w, y: cur.y + cur.height / 2, label: 'Resize' });
         await wait(28);
      }
      await hooks.frame?.(view);
      await wait(200);
      // ...and Format tidies it.
      if (hooks.menu)
         await hooks.menu(
            { x: startL.x + half * 0.55, y: startL.y + 40 },
            [
               { label: 'Format', kbd: 'Shift+Alt+F' },
               { label: 'Fit to content', kbd: 'Shift+Alt+S' },
               { label: 'Copy code' },
               { label: 'Duplicate', kbd: 'Ctrl+D' },
               { label: 'Delete', kbd: 'Del' },
            ],
            'Format'
         );
      else await point(startL.x + half - 60, startL.y + 14, 'Format', 550);
      apply({ kind: 'element.updated', element: { ...startL, text: formatted } as CanvasElementModel });
      await wait(650);
      await typeCode(startR, fitR);

      // Fit to content (Shift+Alt+S): both shrink to their code; the right one keeps its right edge.
      const area = { x: startL.x, y, w: top.width, h: tall };
      // Select both bottom blocks with a marquee drag...
      const m0 = { x: area.x - 24, y: area.y - 20 };
      await point(m0.x, m0.y, 'Select both', 450);
      for (let i = 1; i <= 12; i++) {
         const k = 1 - Math.pow(1 - i / 12, 2);
         const w = (area.w + 48) * k;
         const h = (area.h + 40) * k;
         cursor({ x: m0.x + w, y: m0.y + h, label: 'Select both', box: { x: m0.x, y: m0.y, w, h } });
         await wait(30);
      }
      cursor({ x: m0.x + area.w + 48, y: m0.y + area.h + 40, box: area });
      await wait(350);
      // ...then right-click → Fit to content: both shrink the moment it is clicked.
      if (hooks.menu)
         await hooks.menu(
            { x: startR.x + startR.width * 0.4, y: startR.y + 50 },
            [
               { label: 'Format', kbd: 'Shift+Alt+F' },
               { label: 'Fit to content', kbd: 'Shift+Alt+S' },
               { label: 'Copy code' },
               { label: 'Duplicate', kbd: 'Ctrl+D' },
               { label: 'Delete', kbd: 'Del' },
            ],
            'Fit to content'
         );
      const steps = 14;
      const ease = (i: number) => 1 - Math.pow(1 - i / steps, 3);
      for (let i = 1; i <= steps; i++) {
         const k = ease(i);
         const l = { width: half + (fitL.width - half) * k, height: tall + (fitL.height - tall) * k };
         const r = { width: half + (fitR.width - half) * k, height: tall + (fitR.height - tall) * k };
         apply(
            { kind: 'element.updated', element: { ...fitL, ...l } as CanvasElementModel },
            {
               kind: 'element.updated',
               element: { ...fitR, ...r, x: top.x + top.width - r.width } as CanvasElementModel,
            }
         );
         // The selection outline follows both blocks as they shrink.
         const rx = top.x + top.width - r.width;
         cursor({
            x: rx + r.width * 0.4,
            y: y + 50,
            box: { x: fitL.x, y, w: rx + r.width - fitL.x, h: Math.max(l.height, r.height) },
         });
         await wait(28);
      }
      cursor(null);
      await wait(600);

      // Then drag the left block's edge so the row fills the width again.
      const full = fitR.x - gap - fitL.x;
      await point(fitL.x + fitL.width, fitL.y + fitL.height / 2, 'Resize', 500);
      for (let i = 1; i <= steps; i++) {
         const w = fitL.width + (full - fitL.width) * ease(i);
         apply({ kind: 'element.updated', element: { ...fitL, width: w } as CanvasElementModel });
         cursor({ x: fitL.x + w, y: fitL.y + fitL.height / 2, label: 'Resize' });
         await wait(30);
      }
      cursor(null);
      await wait(500);
   }

   async function dragOut(el: CanvasElementModel, label?: string, created?: () => void): Promise<void> {
      await point(el.x, el.y, label);
      const text = el.text ?? '';
      let cur = { ...el, width: 4, height: 4, text: '', runs: undefined } as CanvasElementModel;
      apply({ kind: 'element.created', element: cur });
      created?.();
      const steps = 12;
      for (let i = 1; i <= steps; i++) {
         const k = 1 - Math.pow(1 - i / steps, 3);
         cur = update(cur, { width: Math.max(4, el.width * k), height: Math.max(4, el.height * k) });
         cursor({ x: el.x + cur.width, y: el.y + cur.height, label });
         await wait(28);
      }
      if (text) {
         await wait(200);
         // Shape labels are centred: the caret sits right of the centred text.
         const fs = el.fontSize ?? 18;
         const cw = fs * 0.55;
         await typeChars(
            cur,
            'text',
            text,
            (t) => ({ x: el.x + el.width / 2 + (t.length * cw) / 2 + 2, y: el.y + el.height / 2 - fs * 0.6 }),
            boxOf(el)
         );
         await wait(200);
      }
      apply({ kind: 'element.updated', element: el });
      await wait(220);
   }

   async function typeText(el: CanvasElementModel): Promise<void> {
      const fs = el.fontSize ?? 20;
      const lh = fs * (el.lineHeight ?? 1.25);
      await point(el.x, el.y + 4, 'Text', 380);
      const cur = { ...el, text: '', runs: undefined } as CanvasElementModel;
      apply({ kind: 'element.created', element: cur });
      const cw = fs * (el.bold ? 0.56 : 0.5);
      await typeChars(
         cur,
         'text',
         el.text ?? '',
         (t) => {
            const lines = t.split('\n');
            return { x: el.x + lines[lines.length - 1].length * cw + 2, y: el.y + (lines.length - 1) * lh };
         },
         boxOf(el)
      );
      await wait(250);
      apply({ kind: 'element.updated', element: el });
      await wait(200);
   }

   /** Card metrics of a code block: title bar, gutter, character and line size. */
   function codeCaret(el: CanvasElementModel, left = 0) {
      const fs = el.fontSize ?? 14;
      const lh = fs * 1.6;
      const cw = fs * 0.6;
      return (t: string) => {
         const lines = t.split('\n');
         return { x: el.x + left + 44 + lines[lines.length - 1].length * cw, y: el.y + 34 + (lines.length - 1) * lh };
      };
   }

   /** Widen a code block to the right when the typed text runs past its edge. */
   function growCode(cur: CanvasElementModel, typed: string): CanvasElementModel {
      const fs = cur.fontSize ?? 14;
      const longest = Math.max(...typed.split('\n').map((l) => l.length));
      const need = 44 + longest * fs * 0.6 + 24;
      return need > cur.width ? update(cur, { width: need }) : cur;
   }

   async function typeCode(
      el: CanvasElementModel,
      settle: CanvasElementModel | null = el
   ): Promise<CanvasElementModel> {
      await point(el.x + 40, el.y + 40, el.fileName ?? 'Code', 380);
      const diff = el.diffText;
      let cur = { ...el, text: '', diffText: undefined } as CanvasElementModel;
      apply({ kind: 'element.created', element: cur });
      const text = el.text ?? '';
      cur = await typeChars(
         cur,
         'text',
         text,
         codeCaret(el),
         boxOf(el),
         0,
         text.length,
         el.diffText ? undefined : growCode
      );
      if (diff) {
         await wait(400);
         cursor({ x: el.x + el.width - 60, y: el.y + 14, label: 'Show diff' });
         await wait(500);
         // Start the right side as a copy, then type only what changes.
         cur = update(cur, { diffText: text });
         await wait(450);
         let p = 0;
         while (p < text.length && p < diff.length && text[p] === diff[p]) p++;
         let s = 0;
         while (s < text.length - p && s < diff.length - p && text[text.length - 1 - s] === diff[diff.length - 1 - s])
            s++;
         cur = update(cur, { diffText: diff.slice(0, p) + diff.slice(diff.length - s) });
         const right = { x: el.x + el.width / 2, y: el.y, w: el.width / 2, h: el.height };
         cur = await typeChars(cur, 'diffText', diff, codeCaret(el, el.width / 2), right, p, diff.length - s);
      }
      await wait(300);
      if (settle) {
         cur = { ...settle, width: el.width, height: el.height, x: el.x, y: el.y } as CanvasElementModel;
         apply({ kind: 'element.updated', element: cur });
      }
      await wait(400);
      return cur;
   }

   async function drawArrow(el: CanvasElementModel): Promise<void> {
      const pts = el.points ?? [];
      const end = pts[pts.length - 1] ?? { x: 0, y: 0 };
      await point(el.x, el.y, undefined, 320);
      let cur = {
         ...el,
         text: '',
         points: [
            { x: 0, y: 0 },
            { x: 0, y: 0 },
         ],
         width: 0,
         height: 0,
      } as CanvasElementModel;
      apply({ kind: 'element.created', element: cur });
      const steps = 10;
      for (let i = 1; i <= steps; i++) {
         const k = i / steps;
         const p = { x: end.x * k, y: end.y * k };
         cur = update(cur, { points: [{ x: 0, y: 0 }, p], width: Math.abs(p.x), height: Math.abs(p.y) });
         cursor({ x: el.x + p.x, y: el.y + p.y });
         await wait(30);
      }
      apply({ kind: 'element.updated', element: el });
      await wait(200);
   }

   async function buildTable(t: TableModel): Promise<void> {
      await point(t.x, t.y, 'New table');
      apply({ kind: 'table.created', table: { ...t, columns: [] } });
      await wait(260);
      for (const [i, c] of t.columns.entries()) {
         const a = columnAnchor(t, i, 'left');
         cursor({ x: a.x + 70, y: a.y, label: c.name });
         apply({ kind: 'column.created', tableId: t.id, column: c });
         await wait(220);
      }
      await wait(150);
   }

   /** Drag from the key column to the referencing column: a dashed guide follows the cursor, then the real connector lands. */
   async function drawRelationship(r: SchemaModel['relationships'][number]): Promise<void> {
      const src = full.tables.find((t) => t.columns.some((c) => c.id === r.sourceColumnId));
      const tgt = full.tables.find((t) => t.columns.some((c) => c.id === r.targetColumnId));
      if (!src || !tgt) {
         apply({ kind: 'relationship.created', relationship: r });
         return;
      }
      const right = tgt.x + 40 > src.x;
      const a = columnAnchor(
         src,
         src.columns.findIndex((c) => c.id === r.sourceColumnId),
         right ? 'right' : 'left'
      );
      const b = columnAnchor(
         tgt,
         tgt.columns.findIndex((c) => c.id === r.targetColumnId),
         right ? 'left' : 'right'
      );
      await point(a.x, a.y, 'Drag key → key', 450);
      await dragGuide(a, b, `rel-${r.id}`, 16, 'Drag key → key');
      apply({ kind: 'relationship.created', relationship: r });
      await wait(380);
   }

   async function buildSequence(diagramId: string): Promise<void> {
      const d = snap.sequenceDiagrams.find((x) => x.id === diagramId)!;
      const lifelines = snap.lifelines.filter((l) => l.diagramId === diagramId).sort((a, b) => a.order - b.order);
      const messages = snap.sequenceMessages.filter((m) => m.diagramId === diagramId).sort((a, b) => a.y - b.y);
      const top = d.originY ?? 0;
      const first = lifelines[0];
      await point(first ? first.x : 0, top + 20, 'Sequence');
      apply({ kind: 'sequenceDiagram.created', diagram: d });
      for (const l of lifelines) {
         cursor({ x: l.x + l.width / 2, y: top + 20, label: l.label });
         apply({ kind: 'lifeline.created', lifeline: l });
         await wait(260);
      }
      for (const m of messages) await addMessage(m);
   }

   async function addMessage(m: SequenceMessageModel): Promise<void> {
      const from = snap.lifelines.find((l) => l.id === m.fromLifelineId);
      const to = snap.lifelines.find((l) => l.id === m.toLifelineId);
      const d = snap.sequenceDiagrams.find((x) => x.id === m.diagramId);
      const top = d?.originY ?? 0;
      if (!from || !to) {
         apply({ kind: 'message.created', message: m });
         return;
      }
      const fx = from.x + from.width / 2;
      const tx = to.x + to.width / 2;
      const index = snap.sequenceMessages.filter(
         (x) => x.diagramId === m.diagramId && x.y < m.y && x.style !== 'break'
      ).length;
      // Every message starts as a plain call; returns, dividers and colours are set afterwards.
      const plain = { ...m, style: 'solid', color: undefined } as SequenceMessageModel;
      // Create it, then measure the real line and hide it while the drag is shown.
      apply({ kind: 'message.created', message: { ...plain, label: '' } });
      await wait(40);
      const dom = hooks.dom?.message(index);
      const line = dom?.line ?? { x: Math.min(fx, tx), y: top + m.y, w: Math.abs(tx - fx), h: 0 };
      const y = line.y + line.h / 2;
      const [ax, bx] = fx < tx ? [line.x, line.x + line.w] : [line.x + line.w, line.x];
      await point(ax, y, undefined, 300);
      await dragGuide({ x: ax, y }, { x: bx, y }, `seq-${m.id}`, 12);
      dom?.hide(false);
      await wait(160);
      // A divider becomes a Break first, so its label is typed straight into the divider.
      if (m.style === 'break') {
         if (hooks.messageStyle) await hooks.messageStyle({ ...m, label: '' });
         else apply({ kind: 'message.updated', message: { ...m, label: '' } });
         const label = m.label ?? '';
         for (let i = 1; i <= label.length; i++) {
            apply({ kind: 'message.updated', message: { ...m, label: label.slice(0, i) } });
            hooks.dom?.revealLabels();
            await wait(34);
         }
         apply({ kind: 'message.updated', message: m });
         await wait(260);
         return;
      }
      // Then type the label; the box and caret follow the rendered label.
      const label = m.label ?? '';
      for (let i = 1; i <= label.length; i++) {
         apply({ kind: 'message.updated', message: { ...plain, label: label.slice(0, i) } });
         await wait(34);
         const lb = dom?.label();
         if (lb) {
            const box = { x: lb.x - 6, y: lb.y - 3, w: Math.max(lb.w + 12, 40), h: lb.h + 6 };
            cursor({ x: lb.x + lb.w + 1, y: lb.y, h: lb.h, box, caret: true });
         }
      }
      if (m.style !== 'solid' || m.color) {
         apply({ kind: 'message.updated', message: plain });
         await wait(200);
         if (hooks.messageStyle) await hooks.messageStyle(m);
      }
      apply({ kind: 'message.updated', message: m });
      hooks.dom?.revealLabels();
      await wait(260);
   }

   return {
      drawPen,
      shrinkText,
      dragGuide,
      buildCodeTrio,
      dragOut,
      typeText,
      codeCaret,
      growCode,
      typeCode,
      drawArrow,
      buildTable,
      drawRelationship,
      buildSequence,
      addMessage,
   };
}

export type CanvasSteps = ReturnType<typeof createCanvasSteps>;
