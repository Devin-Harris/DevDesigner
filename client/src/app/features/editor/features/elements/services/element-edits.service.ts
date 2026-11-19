import { inject, Injectable } from '@angular/core';
import type { CanvasElementModel } from '@devdesigner/shared';
import { revertable, revertItems } from '../../../helpers/layout-placeholders';
import { storeMember } from '../../../helpers/store-slice.helper';
import { ProjectStore } from '../../../state/project/project.store';

/**
 * The slice of ProjectStore that the element floating toolbar, inspector and image-crop overlay use. Components under
 * `elements/components/` inject this instead of the editor-wide store (C3.7), so each
 * leaf's dependency on project state is this explicit list.
 */
@Injectable({ providedIn: 'root' })
export class ElementEdits {
   private readonly store = inject(ProjectStore);

   readonly arrangeSelection = storeMember(this.store, 'arrangeSelection');
   readonly batchHistory = storeMember(this.store, 'batchHistory');
   readonly canEdit = storeMember(this.store, 'canEdit');
   readonly deleteElement = storeMember(this.store, 'deleteElement');
   readonly elements = storeMember(this.store, 'elements');
   readonly presentationThemes = storeMember(this.store, 'presentationThemes');
   readonly selectedElementIds = storeMember(this.store, 'selectedElementIds');
   readonly setElementStyle = storeMember(this.store, 'setElementStyle');
   readonly slideFrames = storeMember(this.store, 'slideFrames');
   readonly updateElement = storeMember(this.store, 'updateElement');
   readonly viewport = storeMember(this.store, 'viewport');

   /** Selected items changed from their slide's layout (or master) that can be reset. */
   revertable(items: readonly CanvasElementModel[]): ReturnType<typeof revertable> {
      return revertable(this.store, items);
   }

   /** Reset items to their layout (or master) placeholder. */
   revertItems(items: readonly CanvasElementModel[]): ReturnType<typeof revertItems> {
      return revertItems(this.store, items);
   }
}
