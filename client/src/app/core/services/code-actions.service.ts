import { Injectable, inject, signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ProjectStore } from '../../stores/project.store';
import { formatCode } from '../../features/editor/canvas/helpers/code-format.helper';
import {
  CODE_FONT_SIZE,
  codeContentSize,
  codeHeaderHeight,
  codeTitle,
  codePrintWidth,
} from '../../features/editor/canvas/helpers/shape-render.helper';

/** Actions on code-block elements shared by the inspector and the floating toolbar. */
@Injectable({ providedIn: 'root' })
export class CodeActionsService {
  private readonly store = inject(ProjectStore);
  private readonly snackBar = inject(MatSnackBar);

  /** Id of the code block whose file name is being edited in place on the canvas. */
  readonly fileNameEditId = signal<string | null>(null);

  /** Open the in-canvas file-name editor on a code block. */
  editFileName(id: string): void {
    this.store.selectElement(id);
    this.fileNameEditId.set(id);
  }

  /** Set (or clear, with an empty value) a code block's file name; the card widens if the title needs it. */
  async setFileName(id: string, value: string): Promise<void> {
    const el = this.store.elements().find((e) => e.id === id);
    if (el?.type !== 'code') {
      return;
    }
    const fileName = value.trim();
    if (fileName === (el.fileName ?? '')) {
      return;
    }
    const minWidth = codeContentSize(
      '',
      el.fontSize ?? CODE_FONT_SIZE,
      codeTitle({ fileName, language: el.language }),
    ).width;
    await this.store.updateElement(id, {
      fileName,
      ...(minWidth > el.width ? { width: minWidth } : {}),
    });
  }

  /** Collapse a code block to its title bar, or restore it to its previous height. */
  async toggleCollapsed(id: string): Promise<void> {
    const el = this.store.elements().find((e) => e.id === id);
    if (el?.type !== 'code') {
      return;
    }
    if (el.expandedHeight != null) {
      await this.store.updateElement(id, { height: el.expandedHeight, expandedHeight: null });
    } else {
      const header = codeHeaderHeight(el.fontSize ?? CODE_FONT_SIZE);
      await this.store.updateElement(id, { height: header, expandedHeight: el.height });
    }
  }

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
        const size = codeContentSize(text, fontSize, codeTitle(el));
        // A collapsed block keeps its title-bar height; only the text changes.
        await this.store.updateElement(el.id, {
          text,
          width: Math.max(el.width, size.width),
          ...(el.expandedHeight == null
            ? { height: Math.max(el.height, size.height) }
            : { expandedHeight: Math.max(el.expandedHeight, size.height) }),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not format the code.';
        this.snackBar.open(`Couldn't format: ${message}`, undefined, { duration: 4000 });
      }
    }
  }

  /** Resize every selected code block to exactly fit its content (width and height, grow or shrink). */
  async fitToContent(ids: readonly string[]): Promise<void> {
    const blocks = this.store
      .elements()
      .filter((e) => e.type === 'code' && ids.includes(e.id));
    for (const el of blocks) {
      const size = codeContentSize(el.text ?? '', el.fontSize ?? CODE_FONT_SIZE, codeTitle(el));
      if (size.width === el.width && size.height === el.height && el.expandedHeight == null) {
        continue;
      }
      // Fitting also expands a collapsed block.
      await this.store.updateElement(el.id, {
        width: size.width,
        height: size.height,
        ...(el.expandedHeight != null ? { expandedHeight: null } : {}),
      });
    }
  }
}
