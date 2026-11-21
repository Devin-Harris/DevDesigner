// The animation list seen as blocks: each block is what one advance of the presentation
// plays (a click), and the first block may play by itself when the slide appears. The
// editor shows blocks as bordered groups and lets cards move within / between blocks and
// whole blocks move between other blocks; these helpers turn those moves into the flat,
// ordered list with the right triggers.

import type { SlideAnimation } from '../models';

/** One click's worth of animations (or, `auto`, what plays when the slide appears). */
export interface AnimationBlock {
  auto: boolean;
  items: SlideAnimation[];
}

/** Split the list into blocks: a `click` opens a new block; a leading non-click block is automatic. */
export function toBlocks(list: readonly SlideAnimation[]): AnimationBlock[] {
  const out: AnimationBlock[] = [];
  for (const a of list) {
    const last = out[out.length - 1];
    if (!last || a.trigger === 'click') {
      out.push({ auto: a.trigger !== 'click', items: [a] });
    } else {
      last.items.push(a);
    }
  }
  return out;
}

/**
 * Flatten blocks back into the list, fixing triggers: a click block's first animation waits
 * for the click, the rest start with / after the one before (a former click becomes
 * `with`). Only the first block may be automatic. Empty blocks drop.
 */
export function fromBlocks(blocks: readonly AnimationBlock[]): SlideAnimation[] {
  const out: SlideAnimation[] = [];
  blocks
    .filter((b) => b.items.length)
    .forEach((b, bi) => {
      const auto = b.auto && bi === 0;
      b.items.forEach((a, i) => {
        let trigger = a.trigger;
        if (i === 0) {
          trigger = auto ? (a.trigger === 'click' ? 'with' : a.trigger) : 'click';
        } else if (trigger === 'click') {
          trigger = 'with';
        }
        out.push(trigger === a.trigger ? a : { ...a, trigger });
      });
    });
  return out;
}

/** Where a dragged card lands: at `index` inside block `block`, or as a new block before block `newBlock`. */
export type CardDrop = { block: number; index: number } | { newBlock: number };

/** Move one animation (by id) to `drop` (indexes as seen before the move). */
export function moveAnimationCard(list: readonly SlideAnimation[], id: string, drop: CardDrop): SlideAnimation[] {
  const blocks = toBlocks(list).map((b) => ({ ...b, items: [...b.items] }));
  let moved: SlideAnimation | undefined;
  let fromBlock = -1;
  let fromIndex = -1;
  blocks.forEach((b, bi) => {
    const i = b.items.findIndex((a) => a.id === id);
    if (i >= 0) {
      moved = b.items[i];
      fromBlock = bi;
      fromIndex = i;
    }
  });
  if (!moved) return [...list];
  if ('block' in drop) {
    const target = blocks[drop.block];
    if (!target) return [...list];
    let index = drop.index;
    if (drop.block === fromBlock && fromIndex < index) index -= 1;
    blocks[fromBlock].items.splice(fromIndex, 1);
    target.items.splice(Math.max(0, Math.min(index, target.items.length)), 0, moved);
  } else {
    blocks[fromBlock].items.splice(fromIndex, 1);
    const at = Math.max(0, Math.min(drop.newBlock, blocks.length));
    // A new first block is a click block (the slide's arrival block, if any, moves down).
    blocks.splice(at, 0, { auto: false, items: [{ ...moved, trigger: 'click' }] });
    if (at === 0 && blocks[1]) blocks[1] = { ...blocks[1], auto: false };
  }
  return fromBlocks(blocks);
}

/** Move block `from` so it sits before block `before` (`before` = block count: to the end). */
export function moveAnimationBlock(list: readonly SlideAnimation[], from: number, before: number): SlideAnimation[] {
  const blocks = toBlocks(list);
  if (from < 0 || from >= blocks.length || before === from || before === from + 1) return [...list];
  const [b] = blocks.splice(from, 1);
  blocks.splice(before > from ? before - 1 : before, 0, b);
  // Whatever ends up first keeps playing on a click unless it was the arrival block and stays first.
  return fromBlocks(blocks.map((x, i) => ({ ...x, auto: x.auto && i === 0 })));
}
