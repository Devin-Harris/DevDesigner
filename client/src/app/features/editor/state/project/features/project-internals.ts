import {
   signalStoreFeature,
   type SignalStoreFeature,
   type SignalStoreFeatureResult,
   type StateSignals,
   type WritableStateSource,
} from '@ngrx/signals';
import { withProjectState } from './project-state.feature';
import { withProjectSelectionState } from './project-selection-state.feature';
import { withProjectSlidesState } from './project-slides-state.feature';
import { withProjectSlidesDerived } from './project-slides-derived.feature';
import { withProjectDerived } from './project-derived.feature';
import { withProjectProps } from './project-props.feature';
import { withProjectSaveQueue } from './project-save-queue.feature';
import { withProjectHistory } from './project-history.feature';
import { withProjectEventHandlers } from './project-event-handlers.feature';

/**
 * The ProjectStore's foundation, in order: state slices, derived values, injected services and
 * the schema writer (`_api`, `_schema`), the write queue (`_queue`), history (`_history`) and the
 * realtime event handlers. Every methods feature builds on it and declares it as its input
 * (`signalStoreFeature(type<ProjectInternals>(), …)`), the `featuresType` analog (§4.4).
 */
export function withProjectCore() {
   return signalStoreFeature(
      withProjectState(),
      withProjectSelectionState(),
      withProjectSlidesState(),
      withProjectSlidesDerived(),
      withProjectDerived(),
      withProjectProps(),
      withProjectSaveQueue(),
      withProjectHistory(),
      withProjectEventHandlers()
   );
}

type FeatureOutput<F> = F extends SignalStoreFeature<SignalStoreFeatureResult, infer Out> ? Out : never;

/** Everything `withProjectCore()` provides (state, derived props, private `_…` props, methods). */
export type ProjectInternals = FeatureOutput<ReturnType<typeof withProjectCore>>;

/** `ProjectInternals` plus the members of earlier methods features a feature needs. */
export interface ProjectInternalsWith<P extends object = object, M extends object = object> {
   state: ProjectInternals['state'];
   props: ProjectInternals['props'] & P;
   methods: ProjectInternals['methods'] & M;
}

/** The inner store a `withProps` / `withMethods` factory over `ProjectInternals` receives. */
export type ProjectInternalsStore<P extends object = object> = StateSignals<ProjectInternals['state']> &
   ProjectInternals['props'] &
   P &
   ProjectInternals['methods'] &
   WritableStateSource<ProjectInternals['state']>;
