import { inject, Injectable } from '@angular/core';
import { storeMember } from '../../../helpers/store-slice.helper';
import { ProjectStore } from '../../../state/project/project.store';

export type { TableGeometry } from '../../../state/project/project.store';

/**
 * The slice of ProjectStore that the ERD inspectors, table node and table toolbar use. Components under
 * `erd/components/` inject this instead of the editor-wide store (C3.7), so each
 * leaf's dependency on project state is this explicit list.
 */
@Injectable({ providedIn: 'root' })
export class ErdEdits {
   private readonly store = inject(ProjectStore);

   readonly addColumn = storeMember(this.store, 'addColumn');
   readonly addIndex = storeMember(this.store, 'addIndex');
   readonly canEdit = storeMember(this.store, 'canEdit');
   readonly deleteColumn = storeMember(this.store, 'deleteColumn');
   readonly deleteIndex = storeMember(this.store, 'deleteIndex');
   readonly deleteRelationship = storeMember(this.store, 'deleteRelationship');
   readonly deleteTable = storeMember(this.store, 'deleteTable');
   readonly duplicateTable = storeMember(this.store, 'duplicateTable');
   readonly enterGroup = storeMember(this.store, 'enterGroup');
   readonly enteredGroupId = storeMember(this.store, 'enteredGroupId');
   readonly groupIdOf = storeMember(this.store, 'groupIdOf');
   readonly moveTable = storeMember(this.store, 'moveTable');
   readonly recordTableScale = storeMember(this.store, 'recordTableScale');
   readonly relationships = storeMember(this.store, 'relationships');
   readonly reorderColumns = storeMember(this.store, 'reorderColumns');
   readonly selectedTableIds = storeMember(this.store, 'selectedTableIds');
   readonly setTableScaleLocal = storeMember(this.store, 'setTableScaleLocal');
   readonly tables = storeMember(this.store, 'tables');
   readonly updateColumn = storeMember(this.store, 'updateColumn');
   readonly updateIndex = storeMember(this.store, 'updateIndex');
   readonly updateRelationship = storeMember(this.store, 'updateRelationship');
   readonly updateTable = storeMember(this.store, 'updateTable');
   readonly updateTableSilently = storeMember(this.store, 'updateTableSilently');
   readonly viewport = storeMember(this.store, 'viewport');
}
