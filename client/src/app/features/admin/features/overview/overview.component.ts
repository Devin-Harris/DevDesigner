import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { AdminApiService } from '../../services/admin-api.service';
import { IconComponent } from '../../../../shared/ui/components/icon/icon.component';

/** Overview placeholder: proves the admin API is reachable until the Phase 2 KPIs land. */
@Component({
   selector: 'dd-admin-overview',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [DatePipe, IconComponent],
   templateUrl: './overview.component.html',
   styleUrl: './overview.component.scss',
})
export class OverviewComponent {
   private readonly adminApi = inject(AdminApiService);

   private readonly ping = rxResource({ stream: () => this.adminApi.ping() });

   protected readonly loading$ = this.ping.isLoading;
   protected readonly failed$ = computed(() => this.ping.error() !== undefined);
   protected readonly serverTime$ = computed(() => this.ping.value()?.serverTime ?? null);

   protected retry(): void {
      this.ping.reload();
   }
}
