import type { TextRun } from '@devdesigner/shared';

/** Per-run style overrides. `null` clears an override (the run inherits the element's style). */
export interface RunPatch {
   bold?: boolean | null;
   italic?: boolean | null;
   underline?: boolean | null;
   color?: string | null;
   /** Morph tag for the characters (empty/null clears it). */
   morph?: string | null;
}

/** The element-level style runs inherit when they have no override of their own. */
export interface RunBase {
   bold: boolean;
   italic: boolean;
   underline: boolean;
   color: string;
}

const KEYS = ['bold', 'italic', 'underline', 'color', 'morph'] as const;

function sameStyle(a: TextRun, b: TextRun): boolean {
   return (
      a.bold === b.bold &&
      a.italic === b.italic &&
      a.underline === b.underline &&
      a.color === b.color &&
      a.morph === b.morph
   );
}

export function plainOf(runs: readonly TextRun[]): string {
   return runs.map((r) => r.text).join('');
}

/** Drop empty runs and merge neighbours that share a style. */
export function normalizeRuns(runs: readonly TextRun[]): TextRun[] {
   const out: TextRun[] = [];
   for (const run of runs) {
      if (!run.text) {
         continue;
      }
      const last = out[out.length - 1];
      if (last && sameStyle(last, run)) {
         last.text += run.text;
      } else {
         const copy: TextRun = { text: run.text };
         for (const k of KEYS) {
            if (run[k] !== undefined) {
               (copy as unknown as Record<string, unknown>)[k] = run[k];
            }
         }
         out.push(copy);
      }
   }
   return out;
}

/** True when no run carries any override, i.e. the block is uniformly styled. */
export function isPlainRuns(runs: readonly TextRun[]): boolean {
   return runs.every((r) => KEYS.every((k) => r[k] === undefined));
}

/**
 * The element's runs when they are usable: they must concatenate to `text`
 * (otherwise they are stale) and actually carry styling. Null = uniform text.
 */
export function usableRuns(text: string, runs: readonly TextRun[] | null | undefined): TextRun[] | null {
   if (!runs?.length || isPlainRuns(runs) || plainOf(runs) !== text) {
      return null;
   }
   return runs.map((r) => ({ ...r }));
}

/** Runs for editing/layout: the element's runs, or a single unstyled run. */
export function runsOrPlain(text: string, runs: readonly TextRun[] | null | undefined): TextRun[] {
   return usableRuns(text, runs) ?? [{ text }];
}

/** Apply a style patch to the character range [start, end), splitting runs at the edges. */
export function patchRuns(runs: readonly TextRun[], start: number, end: number, patch: RunPatch): TextRun[] {
   const out: TextRun[] = [];
   let offset = 0;
   const apply = (run: TextRun): TextRun => {
      const next: TextRun = { ...run };
      for (const k of KEYS) {
         if (!(k in patch)) {
            continue;
         }
         const v = patch[k];
         if (v === null || v === undefined || v === '') {
            delete next[k];
         } else {
            (next as unknown as Record<string, unknown>)[k] = v;
         }
      }
      return next;
   };
   for (const run of runs) {
      const from = offset;
      const to = offset + run.text.length;
      offset = to;
      if (end <= from || start >= to) {
         out.push({ ...run });
         continue;
      }
      const a = Math.max(start, from) - from;
      const b = Math.min(end, to) - from;
      if (a > 0) {
         out.push({ ...run, text: run.text.slice(0, a) });
      }
      out.push(apply({ ...run, text: run.text.slice(a, b) }));
      if (b < run.text.length) {
         out.push({ ...run, text: run.text.slice(b) });
      }
   }
   return normalizeRuns(out);
}

/** Effective flags over a range: true when EVERY character has the flag. */
export function styleOver(
   runs: readonly TextRun[],
   start: number,
   end: number,
   base: RunBase
): { bold: boolean; italic: boolean; underline: boolean; color: string | null; morph: string } {
   let bold = true;
   let italic = true;
   let underline = true;
   let color: string | null | undefined;
   let morph: string | null | undefined;
   let offset = 0;
   let seen = false;
   for (const run of runs) {
      const from = offset;
      const to = offset + run.text.length;
      offset = to;
      // A collapsed caret reads the run it sits in (or just after).
      const hit = start === end ? start > from && start <= to : end > from && start < to;
      if (!hit || !run.text) {
         continue;
      }
      seen = true;
      bold &&= run.bold ?? base.bold;
      italic &&= run.italic ?? base.italic;
      underline &&= run.underline ?? base.underline;
      const c = run.color ?? base.color;
      color = color === undefined ? c : color === c ? c : null;
      const m = run.morph ?? '';
      morph = morph === undefined ? m : morph === m ? m : null;
   }
   if (!seen) {
      return {
         bold: base.bold,
         italic: base.italic,
         underline: base.underline,
         color: base.color,
         morph: '',
      };
   }
   return { bold, italic, underline, color: color ?? null, morph: morph ?? '' };
}

/** Split runs into lines at `\n`; every line keeps at least one (possibly empty) run. */
export function runLines(runs: readonly TextRun[]): TextRun[][] {
   const lines: TextRun[][] = [[]];
   for (const run of runs) {
      const parts = run.text.split('\n');
      parts.forEach((part, i) => {
         if (i > 0) {
            lines.push([]);
         }
         if (part) {
            lines[lines.length - 1].push({ ...run, text: part });
         }
      });
   }
   return lines;
}

/** CSS font-weight of a run given the element's base weight. */
export function runWeight(baseWeight: number, run: Pick<TextRun, 'bold'>): number {
   if (run.bold === undefined) {
      return baseWeight;
   }
   return run.bold ? Math.max(baseWeight, 700) : 400;
}

/**
 * Remove the given per-run overrides everywhere, so an element-level change (a
 * new element color, bold on/off) takes effect on the whole block. Returns null
 * when nothing styled is left (uniform text).
 */
export function clearRunKeys(
   runs: readonly TextRun[] | null | undefined,
   keys: readonly ('bold' | 'italic' | 'underline' | 'color')[]
): TextRun[] | null {
   if (!runs?.length) {
      return null;
   }
   const cleared = normalizeRuns(
      runs.map((r) => {
         const next = { ...r };
         for (const k of keys) {
            delete next[k];
         }
         return next;
      })
   );
   return isPlainRuns(cleared) ? null : cleared;
}
