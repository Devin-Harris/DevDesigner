import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { EmbedFramesService } from '../../../services/embed-frames.service';

/**
 * Shown to people who opened someone else's project that has live frames: those
 * pages load from the viewer's browser, so `localhost` ones only work for whoever
 * runs that server. Offers to show placeholder cards instead (remembered per
 * project in this browser); while they are off, a small pill turns them back on.
 */
@Component({
   selector: 'dd-live-frames-notice',
   changeDetection: ChangeDetectionStrategy.OnPush,
   host: { '(pointerdown)': '$event.stopPropagation()' },
   template: `
      @if (embeds.noticeShown()) {
         <div class="notice" role="status">
            <span class="dot" aria-hidden="true"></span>
            <span class="msg">
               This project has {{ embeds.embeds().length === 1 ? 'a live frame' : embeds.embeds().length + ' live frames' }}
               that load other web pages{{ embeds.hasLocal() ? ' — localhost ones only work on the owner’s machine' : '' }}.
            </span>
            @if (embeds.blocked()) {
               <button type="button" (click)="embeds.setBlocked(false)">Load them</button>
            } @else {
               <button type="button" (click)="embeds.setBlocked(true)">Show placeholders</button>
            }
            <button type="button" class="ghost" aria-label="Dismiss" (click)="embeds.dismissNotice()">OK</button>
         </div>
      } @else if (embeds.blocked() && embeds.embeds().length) {
         <button type="button" class="pill" (click)="embeds.setBlocked(false)">Live frames off · Load them</button>
      }
   `,
   styles: `
      :host {
         position: absolute;
         left: 50%;
         bottom: 16px;
         transform: translateX(-50%);
         z-index: 21;
         max-width: calc(100% - 32px);
      }
      .notice,
      .pill {
         display: flex;
         align-items: center;
         gap: 10px;
         padding: 8px 10px 8px 14px;
         border: 1px solid var(--dd-border, #ddd);
         border-radius: 10px;
         background: var(--dd-surface, #fff);
         color: var(--dd-text, #111);
         box-shadow: 0 6px 24px rgba(0, 0, 0, 0.16);
         font-size: 13px;
      }
      .dot {
         flex: none;
         width: 8px;
         height: 8px;
         border-radius: 50%;
         background: #ef4444;
      }
      .msg {
         line-height: 1.35;
      }
      button {
         flex: none;
         height: 28px;
         padding: 0 10px;
         border: 1px solid var(--dd-border-strong, #bbb);
         border-radius: 6px;
         background: transparent;
         color: inherit;
         font: inherit;
         font-size: 12px;
         cursor: pointer;
      }
      button.ghost {
         border-color: transparent;
      }
      .pill {
         padding: 0 12px;
         height: 30px;
         color: var(--dd-text-muted, #555);
      }
   `,
})
export class LiveFramesNoticeComponent {
   protected readonly embeds = inject(EmbedFramesService);
}
