import { signalStore } from '@ngrx/signals';
import { withProjectCore } from './features/project-internals';
import { withProjectSelectionMethods } from './features/project-selection-methods.feature';
import { withProjectSlidesMethods } from './features/project-slides-methods.feature';
import { withProjectElementsMethods } from './features/project-elements-methods.feature';
import { withProjectCloneMethods } from './features/project-clone-methods.feature';
import { withProjectTablesMethods } from './features/project-tables-methods.feature';
import { withProjectRelationshipsMethods } from './features/project-relationships-methods.feature';
import { withProjectSequenceRowsMethods } from './features/project-sequence-rows-methods.feature';
import { withProjectSequenceMethods } from './features/project-sequence-methods.feature';
import { withProjectLoadMethods } from './features/project-load-methods.feature';
import { withProjectImportMethods } from './features/project-import-methods.feature';

export { elementToCreateDto } from './helpers/element-dto.helper';
export type {
   GroupItemKind,
   GroupMembers,
   ItemMoves,
   SequenceLayoutSnapshot,
   SequenceShift,
   TableGeometry,
} from './models/project-state.model';

/**
 * Editor store: the single source of truth for the loaded project's schema, viewport,
 * selection, access mode, and save status (BUILD_INSTRUCTIONS.md section 8.4). Every edit goes
 * through a method that calls the matching granular endpoint and updates local state
 * optimistically; high-frequency changes (drag, pan/zoom, reorder) are staged and sent as one
 * batch per pause. Composed from features (§4.4): `withProjectCore()` holds the state, derived
 * values, write queue, history and realtime event handlers; the methods features follow per
 * domain.
 */
export const ProjectStore = signalStore(
   { providedIn: 'root' },
   withProjectCore(),
   withProjectSelectionMethods(),
   withProjectSlidesMethods(),
   withProjectElementsMethods(),
   withProjectCloneMethods(),
   withProjectTablesMethods(),
   withProjectRelationshipsMethods(),
   withProjectSequenceRowsMethods(),
   withProjectSequenceMethods(),
   withProjectLoadMethods(),
   withProjectImportMethods()
);
