import { inject, Injectable } from '@angular/core';
import { storeMember } from '../../../helpers/store-slice.helper';
import { ProjectStore } from '../../../state/project/project.store';

/**
 * The slice of ProjectStore that the canvas shape layer use. Components under
 * `canvas/components/` inject this instead of the editor-wide store (C3.7), so each
 * leaf's dependency on project state is this explicit list.
 */
@Injectable({ providedIn: 'root' })
export class CanvasContent {
   private readonly store = inject(ProjectStore);

   readonly canEdit = storeMember(this.store, 'canEdit');
   readonly deleteElement = storeMember(this.store, 'deleteElement');
   readonly elements = storeMember(this.store, 'elements');
   readonly patchElementLocal = storeMember(this.store, 'patchElementLocal');
   readonly updateElement = storeMember(this.store, 'updateElement');
}
