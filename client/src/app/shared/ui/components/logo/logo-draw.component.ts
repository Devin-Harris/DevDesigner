import { booleanAttribute, ChangeDetectionStrategy, Component, input, signal } from '@angular/core';

/** The logo mark's outline, from assets/brand/logo.svg (mark space, before its transform). */
const MARK_PATH =
   'M149.10 28.38 L19.50 225.38 L12.40 234.88 C1.89 248.35 12.29 261.83 18.80 266.88 C43.44 282.08 57.20 267.22 61.00 257.88 C99.46 199.38 178.90 78.38 188.90 62.38 C198.90 46.38 218.80 41.05 227.50 40.38 L298.10 40.38 C298.10 40.38 340.10 38.48 361.60 48.88 C379.10 57.35 415.10 88.38 421.60 144.88 C428.10 201.38 404.42 238.22 374.10 266.88 C346.60 292.88 285.60 290.88 309.60 288.38 C333.60 285.88 353.60 272.88 371.60 254.38 C389.60 235.88 425.60 172.88 398.60 114.88 C377.00 68.48 337.93 58.22 321.10 58.88 L236.20 58.88 C215.80 58.88 205.63 70.22 203.10 75.88 L73.00 270.38 C69.33 276.22 57.52 287.98 39.60 288.38 C21.68 288.78 5.73 276.55 0.00 270.38 L0.00 324.88 L99.90 324.88 C143.76 258.38 233.50 122.38 241.50 110.38 C249.50 98.38 261.36 96.38 266.30 96.88 L309.60 96.88 C319.10 96.05 341.90 101.28 357.10 128.88 C376.10 163.38 364.10 205.88 338.10 234.88 C317.30 258.08 294.43 265.88 285.60 266.88 L162.80 266.88 L125.40 324.88 L338.10 324.88 C367.10 324.88 405.60 309.08 431.60 269.88 C464.10 220.88 480.60 148.88 446.10 75.88 C418.50 17.48 363.93 1.55 340.10 0.88 C297.43 0.22 207.30 -0.72 188.10 0.88 C169.22 2.48 154.23 19.88 149.10 28.38Z';

let nextId = 0;

/**
 * The DevDesigner logo, animated in: the tile springs up, a pen draws the mark along its
 * outline, and a sheen glints across. Keep MARK_PATH in sync with
 * assets/brand/logo.svg.
 */
@Component({
   selector: 'dd-logo-draw',
   template: `
      @for (k of [run$()]; track k) {
         <svg viewBox="0 0 896 896" aria-hidden="true" [attr.width]="size$()" [attr.height]="size$()">
            <defs>
               <linearGradient x1="0" y1="0" x2="1" y2="1" [attr.id]="id + 'bg'">
                  <stop offset="0" stop-color="#6f8bff" />
                  <stop offset="1" stop-color="#3b5bdb" />
               </linearGradient>
               <linearGradient x1="0" y1="0" x2="1" y2="0" [attr.id]="id + 'sheen'">
                  <stop offset="0" stop-color="#fff" stop-opacity="0" />
                  <stop offset="0.5" stop-color="#fff" stop-opacity="0.45" />
                  <stop offset="1" stop-color="#fff" stop-opacity="0" />
               </linearGradient>
               <clipPath [attr.id]="id + 'tile'">
                  <rect width="896" height="896" rx="200" />
               </clipPath>
               <!-- A wide pen runs along the mark's outline; the mark shows wherever it has been. -->
               <mask maskUnits="userSpaceOnUse" x="-60" y="-60" width="600" height="450" [attr.id]="id + 'pen'">
                  <path class="pen" pathLength="1" [attr.d]="path" />
               </mask>
            </defs>
            <g class="tile">
               <rect width="896" height="896" rx="200" [attr.fill]="'url(#' + id + 'bg)'" />
               <g transform="translate(148 238.5) scale(1.2896)">
                  <g [attr.mask]="'url(#' + id + 'pen)'">
                     <path class="mark" fill="#fff" [attr.d]="path" />
                  </g>
                  <path class="tip" pathLength="1" [attr.d]="path" />
               </g>
               <g [attr.clip-path]="'url(#' + id + 'tile)'">
                  <rect
                     class="sheen"
                     x="-400"
                     y="-200"
                     width="300"
                     height="1300"
                     [attr.fill]="'url(#' + id + 'sheen)'"
                  />
               </g>
            </g>
         </svg>
      }
   `,
   styles: `
      :host {
         display: inline-flex;
         flex-shrink: 0;
      }
      svg {
         display: block;
         overflow: visible;
      }
      .tile {
         transform-origin: 448px 448px;
         animation: dd-logo-tile 600ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
      }
      .pen {
         fill: none;
         stroke: #fff;
         stroke-width: 84;
         stroke-linecap: round;
         stroke-linejoin: round;
         stroke-dasharray: 1;
         stroke-dashoffset: 1;
         animation: dd-logo-draw 1300ms cubic-bezier(0.45, 0, 0.3, 1) 300ms forwards;
      }
      /* A bright pen nib leads the stroke, then fades. */
      .tip {
         fill: none;
         stroke: #fff;
         stroke-width: 10;
         stroke-linecap: round;
         stroke-dasharray: 0.03 1;
         stroke-dashoffset: 0.03;
         opacity: 0;
         filter: drop-shadow(0 0 10px #fff);
         animation:
            dd-logo-tip 1300ms cubic-bezier(0.45, 0, 0.3, 1) 300ms forwards,
            dd-logo-tip-fade 1300ms linear 300ms forwards;
      }
      .sheen {
         transform: skewX(-20deg) translateX(0);
         animation: dd-logo-sheen 800ms ease-in-out 1500ms forwards;
      }
      @keyframes dd-logo-tile {
         from {
            transform: scale(0.3) rotate(-14deg);
            opacity: 0;
         }
      }
      @keyframes dd-logo-draw {
         to {
            stroke-dashoffset: 0;
         }
      }
      @keyframes dd-logo-tip {
         from {
            stroke-dashoffset: 1.03;
         }
         to {
            stroke-dashoffset: 0.03;
         }
      }
      @keyframes dd-logo-tip-fade {
         0%,
         100% {
            opacity: 0;
         }
         8%,
         85% {
            opacity: 1;
         }
      }
      @keyframes dd-logo-sheen {
         to {
            transform: skewX(-20deg) translateX(1500px);
         }
      }
      @media (prefers-reduced-motion: reduce) {
         .tile,
         .pen,
         .tip,
         .sheen {
            animation: none;
         }
         .pen {
            stroke-dashoffset: 0;
         }
         .tip,
         .sheen {
            display: none;
         }
      }
   `,
   host: { '(mouseenter)': 'replay()' },
   changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LogoDrawComponent {
   readonly size$ = input(72, { alias: 'size' });
   /** Replay the animation when the pointer enters. */
   readonly replay$ = input(false, { alias: 'replayOnHover', transform: booleanAttribute });
   protected readonly path = MARK_PATH;
   protected readonly id = `dd-logo-${nextId++}-`;
   protected readonly run$ = signal(0);

   protected replay(): void {
      if (this.replay$()) this.run$.update((n) => n + 1);
   }
}
