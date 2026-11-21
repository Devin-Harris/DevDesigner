import { Injectable } from '@angular/core';
import type { CanvasElementModel } from '@devdesigner/shared';
import { CodeBlockSizer } from '../../../core/sandbox/code-block-sizer';
import { codeElementContentSize } from '../helpers/render';

/** The editor's code-block measurement, for the sandbox (bound in `app.config.ts`). */
@Injectable({ providedIn: 'root' })
export class EditorCodeBlockSizer extends CodeBlockSizer {
   size(el: CanvasElementModel): { width: number; height: number } {
      return codeElementContentSize(el);
   }
}
