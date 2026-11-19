import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { formSignal } from 'ngx-form-signal';
import { MatDialogModule } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import type {
   ApiTokenResponse,
   ApiTokenScope,
   CreateApiTokenDto,
   CreatedApiTokenResponse,
   ProjectSummary,
} from '@devdesigner/shared';
import { ApiClientService } from '../../../../core/http/api-client.service';
import { runtimeConfig } from '../../../../core/config/runtime-config';
import { IconComponent } from '../../../ui/components/icon/icon.component';
import { InputComponent } from '../../../ui/components/input/input.component';
import { SegmentedComponent } from '../../../ui/components/segmented/segmented.component';
import { SelectComponent, type SelectOption } from '../../../ui/components/select/select.component';

/**
 * Account → API tokens. Tokens let the MCP server (and other scripts) act as the
 * signed-in user. The secret is shown exactly once, right after creation, next to
 * a ready-to-paste MCP client config; afterwards only a prefix is listed.
 */
@Component({
   selector: 'dd-api-tokens-dialog',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [
      DatePipe,
      ReactiveFormsModule,
      MatDialogModule,
      IconComponent,
      InputComponent,
      SegmentedComponent,
      SelectComponent,
   ],
   templateUrl: './api-tokens-dialog.component.html',
   styleUrl: './api-tokens-dialog.component.scss',
})
export class ApiTokensDialogComponent {
   private readonly api = inject(ApiClientService);

   protected readonly tokens = signal<ApiTokenResponse[]>([]);
   protected readonly loading = signal(true);
   protected readonly form = new FormGroup({
      name: new FormControl('', { nonNullable: true }),
      scope: new FormControl<ApiTokenScope>('write', { nonNullable: true }),
      /** Days until it expires; '' = never. */
      expires: new FormControl('', { nonNullable: true }),
      /** The one project it may touch; '' = all of yours. */
      project: new FormControl('', { nonNullable: true }),
   });
   private readonly form$ = formSignal(this.form);
   protected readonly busy = signal(false);
   protected readonly error = signal<string | null>(null);
   /** The just-created token (with its secret); cleared when the user dismisses it. */
   protected readonly created = signal<CreatedApiTokenResponse | null>(null);
   protected readonly copied = signal<'token' | 'config' | null>(null);
   /** The hosted MCP endpoint of this deployment ('' when running locally). */
   protected readonly remoteMcpUrl = runtimeConfig.mcpUrl;

   protected readonly scopeOptions = [
      { value: 'write', label: 'Read & write' },
      { value: 'read', label: 'Read only' },
   ];
   protected readonly expiryOptions: SelectOption<string>[] = [
      { value: '', label: 'Never expires' },
      { value: '30', label: 'Expires in 30 days' },
      { value: '90', label: 'Expires in 90 days' },
      { value: '365', label: 'Expires in 1 year' },
   ];
   /** Your projects, for limiting a token to one of them. */
   private readonly projects = signal<ProjectSummary[]>([]);
   protected readonly projectOptions = computed<SelectOption<string>[]>(() => [
      { value: '', label: 'All your projects' },
      ...this.projects().map((p) => ({ value: p.id, label: `Only ${p.name}` })),
   ]);
   private readonly projectNames = computed(() => new Map(this.projects().map((p) => [p.id, p.name])));
   protected readonly active = computed(() => this.tokens().filter((t) => !t.revokedAt));

   /** "only <project>" / "expires <date>" / "expired" for a listed token. */
   protected limits(t: ApiTokenResponse): string {
      const parts: string[] = [];
      if (t.projectId) parts.push(`only ${this.projectNames().get(t.projectId) ?? 'one project'}`);
      if (t.expiresAt) {
         const at = new Date(t.expiresAt);
         parts.push(at.getTime() <= Date.now() ? 'expired' : `expires ${at.toLocaleDateString()}`);
      }
      return parts.join(' · ');
   }
   protected readonly canCreate = computed(() => (this.form$.value()?.name ?? '').trim().length > 0 && !this.busy());

   /** Claude Desktop / Claude Code style `mcpServers` entry for the new token. */
   protected readonly configSnippet = computed(() => {
      const created = this.created();
      if (!created) {
         return '';
      }
      if (this.remoteMcpUrl) {
         // Deployed: point clients at the hosted /mcp endpoint; the token rides in a header.
         return JSON.stringify(
            {
               mcpServers: {
                  devdesigner: {
                     type: 'http',
                     url: this.remoteMcpUrl,
                     headers: { Authorization: `Bearer ${created.token}` },
                  },
               },
            },
            null,
            2
         );
      }
      const desktopMcp = runtimeConfig.desktopMcp;
      if (desktopMcp) {
         // Desktop app: its bundled MCP server, launched by the app's own executable.
         return JSON.stringify(
            {
               mcpServers: {
                  devdesigner: {
                     command: desktopMcp.command,
                     args: desktopMcp.args,
                     env: { ...desktopMcp.env, DEVDESIGNER_API_TOKEN: created.token },
                  },
               },
            },
            null,
            2
         );
      }
      const apiUrl = this.absoluteApiUrl();
      return JSON.stringify(
         {
            mcpServers: {
               devdesigner: {
                  command: 'node',
                  args: ['<path to DevDesigner>/mcp/dist/index.js'],
                  env: { DEVDESIGNER_API_URL: apiUrl, DEVDESIGNER_API_TOKEN: created.token },
               },
            },
         },
         null,
         2
      );
   });

   constructor() {
      void this.load();
      void this.loadProjects();
   }

   protected async create(): Promise<void> {
      if (!this.canCreate()) {
         return;
      }
      this.busy.set(true);
      this.error.set(null);
      const { name, scope, expires, project } = this.form.getRawValue();
      const body: CreateApiTokenDto = { name: name.trim(), scope };
      if (expires) body.expiresInDays = Number(expires);
      if (project) body.projectId = project;
      try {
         const created = await firstValueFrom(this.api.post<CreatedApiTokenResponse>('/auth/api-tokens', body));
         this.created.set(created);
         this.form.controls.name.reset();
         await this.load();
      } catch (err) {
         this.error.set(this.describe(err, 'Could not create the token.'));
      } finally {
         this.busy.set(false);
      }
   }

   protected async revoke(token: ApiTokenResponse): Promise<void> {
      this.error.set(null);
      try {
         await firstValueFrom(this.api.delete<void>(`/auth/api-tokens/${token.id}`));
         if (this.created()?.id === token.id) {
            this.created.set(null);
         }
         await this.load();
      } catch (err) {
         this.error.set(this.describe(err, 'Could not revoke the token.'));
      }
   }

   protected async copy(what: 'token' | 'config'): Promise<void> {
      const created = this.created();
      if (!created) {
         return;
      }
      try {
         await navigator.clipboard.writeText(what === 'token' ? created.token : this.configSnippet());
         this.copied.set(what);
         setTimeout(() => this.copied.set(null), 1500);
      } catch {
         this.error.set('Copy failed; select the text and copy it manually.');
      }
   }

   protected dismissCreated(): void {
      this.created.set(null);
   }

   private async load(): Promise<void> {
      try {
         this.tokens.set(await firstValueFrom(this.api.get<ApiTokenResponse[]>('/auth/api-tokens')));
      } catch (err) {
         this.error.set(this.describe(err, 'Could not load tokens.'));
      } finally {
         this.loading.set(false);
      }
   }

   private async loadProjects(): Promise<void> {
      try {
         this.projects.set(await firstValueFrom(this.api.get<ProjectSummary[]>('/projects?archived=false')));
      } catch {
         // Limiting to a project is optional; without the list the menu offers "All".
      }
   }

   private absoluteApiUrl(): string {
      const base = runtimeConfig.apiBaseUrl;
      return /^https?:\/\//.test(base) ? base : `${window.location.origin}${base}`;
   }

   private describe(err: unknown, fallback: string): string {
      const message = (err as { error?: { message?: string | string[] } })?.error?.message;
      return Array.isArray(message) ? message.join(' ') : (message ?? fallback);
   }
}
