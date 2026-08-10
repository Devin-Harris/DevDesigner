import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Shared-link entry (route: /shared/:token). Phase 5 resolves the token, loads
 * the project into the store in shared mode with the returned access level, and
 * renders the editor (EDIT or read-only VIEW). Placeholder for now.
 */
@Component({
  selector: 'app-share',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './share.component.html',
  styleUrl: './share.component.scss',
})
export class ShareComponent {}
