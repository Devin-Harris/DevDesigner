import { signalStoreFeature, withState } from '@ngrx/signals';
import type { ViewportModel } from '@devdesigner/shared';
import type { ProjectCoreState } from '../models/project-state.model';

export const DEFAULT_VIEWPORT: ViewportModel = { x: 0, y: 0, zoom: 1 };

const initialCoreState: ProjectCoreState = {
   projectId: null,
   schema: null,
   viewport: DEFAULT_VIEWPORT,
   home: null,
   customThemes: [],
   accessMode: 'VIEW',
   shared: false,
   loading: false,
   error: null,
   saveStatus: 'idle',
   undoDepth: 0,
   redoDepth: 0,
   elementStyle: {
      fillStyle: 'none',
      strokeWidth: 2,
      strokeStyle: 'solid',
      opacity: 100,
      fontFamily: 'hand',
      fontSize: 20,
   },
};

/** The loaded project, access, view slots, save status and the sticky element style. */
export function withProjectState() {
   return signalStoreFeature(withState(initialCoreState));
}
