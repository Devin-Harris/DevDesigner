import { inject } from '@angular/core';
import { signalStoreFeature, withProps } from '@ngrx/signals';
import { AdminApiService } from '../../../services/admin-api.service';

/** Injected services the method features use. */
export function withAdminProps() {
   return signalStoreFeature(withProps(() => ({ _api: inject(AdminApiService) })));
}
