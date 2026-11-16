import { signalStoreFeature, withState } from '@ngrx/signals';
import type { ProjectSlidesState } from '../models/project-state.model';

const initialSlidesState: ProjectSlidesState = {
   activeSlideKey: null,
   selectedPresentationKey: null,
   shownByPresentationKey: {},
   slideZoom: {},
};

/** Which slide/presentation the canvas shows and each presentation's view zoom (never saved). */
export function withProjectSlidesState() {
   return signalStoreFeature(withState(initialSlidesState));
}
