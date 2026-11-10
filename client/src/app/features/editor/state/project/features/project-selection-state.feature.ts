import { signalStoreFeature, withState } from '@ngrx/signals';
import type { ProjectSelectionState } from '../models/project-state.model';

const initialSelectionState: ProjectSelectionState = {
   selectedTableIds: [],
   selectedRelationshipIds: [],
   selectedElementIds: [],
   selectedLifelineIds: [],
   selectedMessageIds: [],
   selectedDiagramIds: [],
   enteredGroupId: null,
   pendingMessageEditId: null,
   pendingLifelineEditId: null,
};

/** Selected ids per kind, the entered group and pending inline-edit requests. */
export function withProjectSelectionState() {
   return signalStoreFeature(withState(initialSelectionState));
}
