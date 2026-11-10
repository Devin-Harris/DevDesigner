import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { EditorComponent } from '../editor/editor.component';

/**
 * Shared-link entry (route: /shared/:token). Renders the same editor in shared
 * mode: passing the token makes the store load the project via GET /shared/:token
 * and set the effective access level (EDIT read/write, or read-only VIEW). No
 * login is shown. Invalid, revoked, or expired tokens surface as the editor's
 * error overlay from the failed load.
 */
@Component({
   selector: 'app-share',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [EditorComponent],
   templateUrl: './share.component.html',
   styleUrl: './share.component.scss',
})
export class ShareComponent {
   private readonly route = inject(ActivatedRoute);
   protected readonly token = this.route.snapshot.paramMap.get('token');
}
