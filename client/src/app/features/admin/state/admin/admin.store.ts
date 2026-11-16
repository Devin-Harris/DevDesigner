import { signalStore } from '@ngrx/signals';
import { withAdminDerived } from './features/admin-derived.feature';
import { withAdminMethods } from './features/admin-methods.feature';
import { withAdminProps } from './features/admin-props.feature';
import { withAdminState } from './features/admin-state.feature';

/**
 * Admin dashboard state: the shared date range and per-page filters, plus every
 * `/api/admin/*` response cached by request key. Pages call `connect(resource)` and read
 * that resource's view; changing a filter refetches only the resources that depend on it.
 * Provided on the admin shell route, so it lives as long as the admin area is open.
 */
export const AdminStore = signalStore(withAdminProps(), withAdminState(), withAdminDerived(), withAdminMethods());
