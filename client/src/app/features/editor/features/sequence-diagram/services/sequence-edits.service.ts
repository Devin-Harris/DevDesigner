import { inject, Injectable } from '@angular/core';
import { storeMember } from '../../../helpers/store-slice.helper';
import { ProjectStore } from '../../../state/project/project.store';

/**
 * The slice of ProjectStore that the sequence inspector and participant / message toolbars use. Components under
 * `sequence-diagram/components/` inject this instead of the editor-wide store (C3.7), so each
 * leaf's dependency on project state is this explicit list.
 */
@Injectable({ providedIn: 'root' })
export class SequenceEdits {
   private readonly store = inject(ProjectStore);

   readonly addLifeline = storeMember(this.store, 'addLifeline');
   readonly arrangeSelection = storeMember(this.store, 'arrangeSelection');
   readonly canEdit = storeMember(this.store, 'canEdit');
   readonly deleteLifeline = storeMember(this.store, 'deleteLifeline');
   readonly deleteMessage = storeMember(this.store, 'deleteMessage');
   readonly lifelines = storeMember(this.store, 'lifelines');
   readonly requestLifelineEdit = storeMember(this.store, 'requestLifelineEdit');
   readonly requestMessageEdit = storeMember(this.store, 'requestMessageEdit');
   readonly selectedDiagram = storeMember(this.store, 'selectedDiagram');
   readonly selectedLifeline = storeMember(this.store, 'selectedLifeline');
   readonly selectedMessage = storeMember(this.store, 'selectedMessage');
   readonly sequenceDiagrams = storeMember(this.store, 'sequenceDiagrams');
   readonly sequenceMessages = storeMember(this.store, 'sequenceMessages');
   readonly updateLifeline = storeMember(this.store, 'updateLifeline');
   readonly updateMessage = storeMember(this.store, 'updateMessage');
   readonly updateSequenceConfig = storeMember(this.store, 'updateSequenceConfig');
}
