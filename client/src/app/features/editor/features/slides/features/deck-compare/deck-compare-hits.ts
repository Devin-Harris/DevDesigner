import { computed } from '@angular/core';
import {
   type CanvasElementModel,
   type GridPart,
   gridMorphPairs,
   gridPartTag,
   matchMorphItems,
   morphMode,
   onlyYourPairs,
   parseGrid,
   slideMorphKey,
   transitionMorphs,
} from '@devdesigner/shared';
import { lineEnds } from '../../../../helpers/render';
import { tableBox } from '../../../../helpers/node-metrics.helper';
import { gridPartLabel } from './grid-zones.helper';
import { COL, type Hit, type MorphPair, PAIR_COLORS, type PartLine, type Side } from './deck-compare.model';
import type { DeckCompareComponent } from './deck-compare.component';

/** Hit lists, item extraction and pair lines for the deck comparison. */
export class DeckCompareHits {
   constructor(private readonly host: DeckCompareComponent) {}

   hits(side: 'a' | 'b'): Hit[] {
      const { A, B, matches } = this.host.matching();
      const list = side === 'a' ? A : B;
      const frame = side === 'a' ? this.host.previous() : this.host.slide();
      if (!frame) return [];
      const pairOf = new Map<number, { n: number; other: number }>();
      matches.forEach(([i, j], n) => pairOf.set(side === 'a' ? i : j, { n, other: side === 'a' ? j : i }));
      const otherKey = (k: number): string => (side === 'a' ? `b${k}` : `a${k}`);
      return list.map((s, k) => {
         const p = pairOf.get(k);
         const it = s.item;
         const own = side === 'a' ? it.keyOut : it.keyIn;
         const forced = !!own && own.startsWith('tag:pair-');
         const chainMap = side === 'a' ? this.host.chainA() : this.host.chainB();
         const el = s.id ? this.host.store.elements().find((e) => e.id === s.id) : undefined;
         let line: Hit['line'] = null;
         if (el && (el.type === 'line' || el.type === 'arrow')) {
            const pts = lineEnds(el, this.host.targetBox);
            const p0 = pts[0];
            const p1 = pts[pts.length - 1];
            if (p0 && p1) {
               const dx = p1.x - p0.x;
               const dy = p1.y - p0.y;
               line = {
                  cx: (((p0.x + p1.x) / 2 - frame.x) / frame.width) * 100,
                  cy: (((p0.y + p1.y) / 2 - frame.y) / frame.height) * 100,
                  len: (Math.hypot(dx, dy) / frame.width) * 100,
                  angle: (Math.atan2(dy, dx) * 180) / Math.PI,
               };
            }
         }
         let grid: Hit['grid'] = null;
         if (el?.type === 'grid') {
            const g = parseGrid(el.text);
            grid = { rows: g.rows, cols: g.cols };
         }
         return {
            line,
            grid,
            key: `${side}${k}`,
            id: s.id,
            label: s.label,
            left: ((it.cx - it.w / 2) / frame.width) * 100,
            top: ((it.cy - it.h / 2) / frame.height) * 100,
            width: (it.w / frame.width) * 100,
            height: (it.h / frame.height) * 100,
            // Any part past the slide's edges (not only wholly off it): the slide's dashed
            // reach then takes it in and the view never clips it.
            outside:
               it.cx - it.w / 2 < -0.5 ||
               it.cy - it.h / 2 < -0.5 ||
               it.cx + it.w / 2 > frame.width + 0.5 ||
               it.cy + it.h / 2 > frame.height + 0.5,
            num: p ? p.n + 1 : null,
            color: p ? PAIR_COLORS[p.n % PAIR_COLORS.length] : null,
            forced,
            partner: p ? otherKey(p.other) : null,
            cut: !!own && own.startsWith('tag:cut-'),
            solo: !!own && own.startsWith('tag:solo-'),
            chain: s.id ? (chainMap.get(s.id) ?? null) : null,
         };
      });
   }

   /** Pairs of a neighbouring transition: element id on `side` -> partner label. */
   neighbourPairs(
      from: CanvasElementModel | null,
      to: CanvasElementModel | null,
      side: 'from' | 'to'
   ): Map<string, string> {
      const out = new Map<string, string>();
      if (!from || !to || !transitionMorphs(to.slide?.transition)) return out;
      const A = this.itemsOf(from);
      const B = this.itemsOf(to);
      const all = matchMorphItems(
         A.map((x) => x.item),
         B.map((x) => x.item)
      );
      const mode = morphMode(to.slide?.transition);
      for (const [i, j] of mode === 'mine'
         ? onlyYourPairs(
              A.map((x) => x.item),
              B.map((x) => x.item),
              all
           )
         : all) {
         const mine = side === 'from' ? A[i] : B[j];
         const other = side === 'from' ? B[j] : A[i];
         if (mine.id) out.set(mine.id, other.label);
      }
      return out;
   }

   /** Rows, columns and cells paired by hand between two paired tables, as lines. */
   readonly partLines$ = computed<PartLine[]>(() => {
      if (!this.host.previous()) return [];
      const els = new Map(this.host.store.elements().map((e) => [e.id, e] as const));
      const out: PartLine[] = [];
      const { A, B, matches } = this.host.matching();
      matches.forEach(([i, j], n) => {
         const ea = A[i].id ? els.get(A[i].id!) : undefined;
         const eb = B[j].id ? els.get(B[j].id!) : undefined;
         if (ea?.type !== 'grid' || eb?.type !== 'grid') return;
         const ga = parseGrid(ea.text);
         const gb = parseGrid(eb.text);
         if (!ga.morph || !gb.morph) return;
         const p = gridMorphPairs(ga, gb);
         const parts: Array<[GridPart, GridPart]> = [
            ...p.rows.map(([x, y]): [GridPart, GridPart] => [
               { kind: 'row', i: x },
               { kind: 'row', i: y },
            ]),
            ...p.cols.map(([x, y]): [GridPart, GridPart] => [
               { kind: 'col', i: x },
               { kind: 'col', i: y },
            ]),
            ...p.cells.map(([x, y]): [GridPart, GridPart] => [
               { kind: 'cell', r: x[0], c: x[1] },
               { kind: 'cell', r: y[0], c: y[1] },
            ]),
         ];
         for (const [pa, pb] of parts) {
            const s = this.host.centerOf('a', `a${i}`, pa);
            const e = this.host.centerOf('b', `b${j}`, pb);
            if (!s || !e) continue;
            const mx = (s.x + e.x) / 2;
            out.push({
               key: `${i}-${j}-${JSON.stringify(pa)}`,
               pa,
               pb,
               a: `a${i}`,
               b: `b${j}`,
               aId: ea.id,
               bId: eb.id,
               tag: gridPartTag(ga, pa, 'out')!,
               color: PAIR_COLORS[n % PAIR_COLORS.length],
               label: `${gridPartLabel(pa)} → ${gridPartLabel(pb)}`,
               x1: s.x,
               y1: s.y,
               x2: e.x,
               y2: e.y,
               d: `M${s.x} ${s.y} C ${mx} ${s.y}, ${mx} ${e.y}, ${e.x} ${e.y}`,
            });
         }
      });
      return out;
   });

   readonly lines$ = computed(() => {
      const prev = this.host.previous();
      const cur = this.host.slide();
      if (!prev) return [];
      const ka = COL / (prev.width || 1);
      const kb = COL / (cur.width || 1);
      const { A, B, matches } = this.host.matching();
      // Tables whose rows / columns / cells are paired show those links instead.
      const parted = new Set(this.partLines$().map((l) => `${l.a}-${l.b}`));
      return matches.flatMap(([i, j], n) => {
         if (parted.has(`a${i}-b${j}`)) return [];
         const a = A[i].item;
         const b = B[j].item;
         // A line/arrow's link end sits at the middle of the drawn line.
         const la = this.host.hitsA$()[i]?.line;
         const lb = this.host.hitsB$()[j]?.line;
         const x1 = la ? (la.cx / 100) * COL : a.cx * ka;
         const y1 = la ? (la.cy / 100) * prev.height * ka : a.cy * ka;
         const x2 = COL + this.host.gap() + (lb ? (lb.cx / 100) * COL : b.cx * kb);
         const y2 = lb ? (lb.cy / 100) * cur.height * kb : b.cy * kb;
         const mx = (x1 + x2) / 2;
         return {
            key: `${i}-${j}`,
            a: `a${i}`,
            b: `b${j}`,
            aId: A[i].id,
            bId: B[j].id,
            x1,
            y1,
            x2,
            y2,
            color: PAIR_COLORS[n % PAIR_COLORS.length],
            d: `M${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`,
         };
      });
   });

   // ---- the pairs list (right dock) ----
   readonly pairs$ = computed<MorphPair[]>(() => {
      const { A, B, matches } = this.host.matching();
      const usedA = new Set(matches.map(([i]) => i));
      const usedB = new Set(matches.map(([, j]) => j));
      const out: MorphPair[] = matches.map(([i, j], n) => {
         const a = A[i].item;
         const b = B[j].item;
         const forced = !!a.keyOut && a.keyOut === b.keyIn;
         const why: MorphPair['why'] =
            forced || ((a.keyOut ?? a.key) === (b.keyIn ?? b.key) && (b.keyIn ?? b.key).startsWith('tag:'))
               ? 'tag'
               : b.type === 'text'
                 ? 'text'
                 : a.text && a.text === b.text
                   ? 'name'
                   : 'look-alike';
         return {
            from: A[i].label,
            to: B[j].label,
            why,
            a: { x: a.cx, y: a.cy },
            b: { x: b.cx, y: b.cy },
            aId: A[i].id,
            bId: B[j].id,
            forced,
            aKey: `a${i}`,
            bKey: `b${j}`,
            color: PAIR_COLORS[n % PAIR_COLORS.length],
         };
      });
      B.forEach((b, j) => {
         if (!usedB.has(j))
            out.push({
               from: '—',
               to: b.label,
               why: 'fades in',
               aId: null,
               bId: b.id,
               forced: !!b.item.keyIn,
               cut: !!b.item.keyIn?.startsWith('tag:cut-'),
               aKey: null,
               bKey: `b${j}`,
               color: null,
            });
      });
      A.forEach((a, i) => {
         if (!usedA.has(i))
            out.push({
               from: a.label,
               to: '—',
               why: 'fades out',
               aId: a.id,
               bId: null,
               forced: !!a.item.keyOut,
               cut: !!a.item.keyOut?.startsWith('tag:cut-'),
               aKey: `a${i}`,
               bKey: null,
               color: null,
            });
      });
      return out;
   });

   itemsOf(frame: CanvasElementModel): Side[] {
      const byId = new Map(this.host.store.elements().map((e) => [e.id, e] as const));
      const out: Side[] = [];
      for (const e of this.host.store.elements()) {
         if (e.slideId !== frame.id || e.type === 'frame' || (e.placeholder && !(e.text ?? '').trim())) continue;
         const text = (e.text ?? '').trim();
         out.push({
            item: {
               key: slideMorphKey(e, (id) => byId.get(id)),
               keyIn: e.morphIn ?? undefined,
               keyOut: e.morphOut ?? undefined,
               kind: 'element',
               type: e.type,
               text: e.type === 'grid' ? '' : (e.text ?? ''),
               cx: e.x + e.width / 2 - frame.x,
               cy: e.y + e.height / 2 - frame.y,
               w: e.width,
               h: e.height,
            },
            label: (e.type === 'grid' ? '' : text.split('\n')[0].slice(0, 28)) || e.fileName || e.type,
            id: e.id,
         });
      }
      for (const t of this.host.store.tables()) {
         if (t.slideId !== frame.id) continue;
         const b = tableBox(t);
         out.push({
            item: {
               key: t.morphId ?? t.id,
               kind: 'table',
               type: 'table',
               text: t.name,
               cx: (b.x0 + b.x1) / 2 - frame.x,
               cy: (b.y0 + b.y1) / 2 - frame.y,
               w: b.x1 - b.x0,
               h: b.y1 - b.y0,
            },
            label: t.name,
            id: null,
         });
      }
      return out;
   }
}
