import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ProjectStore } from '../../stores/project.store';
import { formatCode } from '../../features/editor/canvas/helpers/code-format.helper';
import {
  CODE_FONT_SIZE,
  codeContentSize,
  codePrintWidth,
} from '../../features/editor/canvas/helpers/shape-render.helper';

/** Actions on code-block elements shared by the inspector and the floating toolbar. */
@Injectable({ providedIn: 'root' })
export class CodeActionsService {
  private readonly store = inject(ProjectStore);
  private readonly snackBar = inject(MatSnackBar);

  /** Prettier-format every selected code block to its card's width, growing the card taller to fit. */
  async format(ids: readonly string[]): Promise<void> {
    const blocks = this.store
      .elements()
      .filter((e) => e.type === 'code' && ids.includes(e.id));
    for (const el of blocks) {
      try {
        const fontSize = el.fontSize ?? CODE_FONT_SIZE;
        // Re-flow to the card's current width: it grows taller, not wider.
        const text = await formatCode(el.text ?? '', el.language, codePrintWidth(el));
        if (text === (el.text ?? '')) {
          continue;
        }
        const size = codeContentSize(text, fontSize);
        await this.store.updateElement(el.id, {
          text,
          width: Math.max(el.width, size.width),
          height: Math.max(el.height, size.height),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not format the code.';
        this.snackBar.open(`Couldn't format: ${message}`, undefined, { duration: 4000 });
      }
    }
  }
}
