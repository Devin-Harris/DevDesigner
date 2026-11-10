import { ChangeDetectionStrategy, Component, computed, inject, signal, type WritableSignal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import type { ApiTokenResponse, ApiTokenScope, CreatedApiTokenResponse } from '@devdesigner/shared';
import { ApiClientService } from '../../core/http/api-client.service';
import { environment } from '../../../environments/environment';
import { IconComponent } from '../../shared/ui/components/icon/icon.component';
import { InputComponent } from '../../shared/ui/components/input/input.component';
import { SegmentedComponent } from '../../shared/ui/components/segmented/segmented.component';

/**
 * Account → API tokens. Tokens let the MCP server (and other scripts) act as the
 * signed-in user. The secret is shown exactly once, right after creation, next to
 * a ready-to-paste MCP client config; afterwards only a prefix is listed.
 */
@Component({
   selector: 'dd-api-tokens-dialog',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [DatePipe, FormsModule, MatDialogModule, IconComponent, InputComponent, SegmentedComponent],
   templateUrl: './api-tokens-dialog.component.html',
   styleUrl: './api-tokens-dialog.component.scss',
})
export class ApiTokensDialogComponent {
   private readonly api = inject(ApiClientService);

   protected readonly tokens = signal<ApiTokenResponse[]>([]);
   protected readonly loading = signal(true);
   protected readonly name = signal('');
   protected readonly scope = signal<ApiTokenScope>('write');
   protected readonly busy = signal(false);
   protected readonly error = signal<string | null>(null);
   /** The just-created token (with its secret); cleared when the user dismisses it. */
   protected readonly created = signal<CreatedApiTokenResponse | null>(null);
   protected readonly copied = signal<'token' | 'config' | null>(null);
   /** The hosted MCP endpoint of this deployment ('' when running locally). */
   protected readonly remoteMcpUrl = environment.mcpUrl;

   protected readonly scopeOptions = [
      { value: 'write', label: 'Read & write' },
      { value: 'read', label: 'Read only' },
   ];
   protected readonly active = computed(() => this.tokens().filter((t) => !t.revokedAt));
   protected readonly canCreate = computed(() => this.name().trim().length > 0 && !this.busy());

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
   }

   protected set(signalRef: WritableSignal<string>, value: string | number): void {
      signalRef.set(String(value));
   }

   protected setScope(value: string): void {
      this.scope.set(value as ApiTokenScope);
   }

   protected async create(): Promise<void> {
      if (!this.canCreate()) {
         return;
      }
      this.busy.set(true);
      this.error.set(null);
      try {
         const created = await firstValueFrom(
            this.api.post<CreatedApiTokenResponse>('/auth/api-tokens', {
               name: this.name().trim(),
               scope: this.scope(),
            })
         );
         this.created.set(created);
         this.name.set('');
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

   private absoluteApiUrl(): string {
      const base = environment.apiBaseUrl;
      return /^https?:\/\//.test(base) ? base : `${window.location.origin}${base}`;
   }

   private describe(err: unknown, fallback: string): string {
      const message = (err as { error?: { message?: string | string[] } })?.error?.message;
      return Array.isArray(message) ? message.join(' ') : (message ?? fallback);
   }
}
