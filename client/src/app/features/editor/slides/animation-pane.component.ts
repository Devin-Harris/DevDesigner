import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  DIRECTIONAL_EFFECTS,
  SLIDE_ANIMATION_EFFECTS_BY_KIND,
  effectFor,
  newAnimation,
  normalizeAnimations,
  planAnimations,
  slideAnimations,
  type CanvasElementModel,
  type SlideAnimation,
  type SlideAnimationEffect,
  type SlideAnimationKind,
  type SlideAnimationTrigger,
  type SlideDirection,
} from '@devdesigner/shared';
import { IconComponent } from '../../../shared/ui/icon/icon.component';
import { SelectComponent, type SelectOption } from '../../../shared/ui/select/select.component';
import { ProjectStore } from '../../../stores/project.store';
import { contentForFrame } from '../canvas/helpers/frame-contents.helper';

const KIND_OPTIONS: SelectOption<SlideAnimationKind>[] = [
  { value: 'enter', label: 'Entrance' },
  { value: 'exit', label: 'Exit' },
  { value: 'emphasis', label: 'Emphasis' },
];

const TRIGGER_OPTIONS: SelectOption<SlideAnimationTrigger>[] = [
  { value: 'click', label: 'On click' },
  { value: 'with', label: 'With previous' },
  { value: 'after', label: 'After previous' },
];

const DIRECTION_OPTIONS: SelectOption<SlideDirection>[] = [
  { value: 'left', label: 'From the left' },
  { value: 'right', label: 'From the right' },
  { value: 'up', label: 'From the top' },
  { value: 'down', label: 'From the bottom' },
];

const EXIT_DIRECTION_OPTIONS: SelectOption<SlideDirection>[] = [
  { value: 'left', label: 'To the left' },
  { value: 'right', label: 'To the right' },
  { value: 'up', label: 'To the top' },
  { value: 'down', label: 'To the bottom' },
];

const EFFECT_NAMES: Record<SlideAnimationKind, Record<SlideAnimationEffect, string>> = {
  enter: { appear: 'Appear', fade: 'Fade in', fly: 'Fly in', wipe: 'Wipe in', zoom: 'Zoom in', pulse: 'Pulse' },
  exit: {
    appear: 'Disappear',
    fade: 'Fade out',
    fly: 'Fly out',
    wipe: 'Wipe out',
    zoom: 'Zoom out',
    pulse: 'Pulse',
  },
  emphasis: { appear: 'Appear', fade: 'Fade', fly: 'Fly', wipe: 'Wipe', zoom: 'Zoom', pulse: 'Pulse' },
};

const TYPE_NAMES: Record<string, string> = {
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
  line: 'Line',
  arrow: 'Arrow',
  freedraw: 'Drawing',
  text: 'Text',
  image: 'Image',
  code: 'Code',
};

interface Target {
  label: string;
  kind: 'element' | 'table' | 'diagram';
  x: number;
  y: number;
}

/**
 * The animation list of one slide (PowerPoint's animation pane): which objects animate,
 * with what effect, and in what order. Row order is play order; each row starts on a
 * click, with the row above, or after it. Edits are ordinary slide updates, so they
 * sync live and undo like any other change.
 */
@Component({
  selector: 'app-animation-pane',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, SelectComponent],
  template: `
    @if (canEdit()) {
      <button class="add" [disabled]="!selectedTargets().length" (click)="addSelected()">
        <dd-icon name="add" />
        Add animation{{ selectedTargets().length > 1 ? ' to ' + selectedTargets().length + ' objects' : '' }}
      </button>
      @if (!selectedTargets().length && !rows().length) {
        <p class="hint">
          Select an object on the slide, then add an animation to bring it in, take it out, or
          draw attention to it. Animations play in the order listed.
        </p>
      }
    }

    @if (rows().length) {
      <ol class="rows">
        @for (r of rows(); track r.animation.id; let i = $index) {
          @if (r.animation.trigger === 'click' || i === 0) {
            <li class="mark" aria-hidden="true">
              {{ r.animation.trigger === 'click' ? 'Click ' + r.click : 'Starts by itself' }}
            </li>
          }
          <li
            class="row"
            [class.sel]="r.animation.id === selectedId()"
            [class.gone]="!r.target"
            (click)="pickRow(r.animation)"
          >
            <span class="idx">{{ i + 1 }}</span>
            <span class="what">
              <span class="name">{{ r.target?.label ?? 'Missing object' }}</span>
              <span class="how">
                {{ effectName(r.animation) }}
                @if (r.animation.trigger !== 'click') {
                  · {{ r.animation.trigger === 'with' ? 'with previous' : 'after previous' }}
                }
              </span>
            </span>
            @if (canEdit()) {
              <button
                class="icon"
                aria-label="Remove animation"
                title="Remove"
                (click)="remove(r.animation.id); $event.stopPropagation()"
              >
                <dd-icon name="close" />
              </button>
            }
          </li>
        }
      </ol>
      <p class="sum">
        {{ summary() }}
        <button class="link" (click)="play.emit()"><dd-icon name="play_arrow" />Preview</button>
      </p>
    }

    @if (selected(); as a) {
      <div class="detail">
        <div class="two">
          <label class="field">
            <span>Type</span>
            <dd-select
              [options]="kindOptions"
              [ngModel]="a.kind"
              [disabled]="!canEdit()"
              (ngModelChange)="patch(a.id, { kind: $event, effect: effectFor($event, a.effect) })"
            />
          </label>
          <label class="field">
            <span>Effect</span>
            <dd-select
              [options]="effectOptions()"
              [ngModel]="a.effect"
              [disabled]="!canEdit()"
              (ngModelChange)="patch(a.id, { effect: $event })"
            />
          </label>
        </div>
        @if (directional(a)) {
          <label class="field">
            <span>Direction</span>
            <dd-select
              [options]="a.kind === 'exit' ? exitDirections : directions"
              [ngModel]="a.direction ?? 'left'"
              [disabled]="!canEdit()"
              (ngModelChange)="patch(a.id, { direction: $event })"
            />
          </label>
        }
        <label class="field">
          <span>Start</span>
          <dd-select
            [options]="triggerOptions"
            [ngModel]="a.trigger"
            [disabled]="!canEdit()"
            (ngModelChange)="patch(a.id, { trigger: $event })"
          />
        </label>
        @if (a.effect !== 'appear') {
          <div class="two">
            <label class="field">
              <span>Duration (ms)</span>
              <input
                type="number"
                min="50"
                max="10000"
                step="50"
                [ngModel]="a.duration"
                [disabled]="!canEdit()"
                (change)="patch(a.id, { duration: num($any($event.target).value, a.duration) })"
              />
            </label>
            <label class="field">
              <span>Delay (ms)</span>
              <input
                type="number"
                min="0"
                max="30000"
                step="100"
                [ngModel]="a.delay"
                [disabled]="!canEdit()"
                (change)="patch(a.id, { delay: num($any($event.target).value, a.delay) })"
              />
            </label>
          </div>
        } @else {
          <label class="field">
            <span>Delay (ms)</span>
            <input
              type="number"
              min="0"
              max="30000"
              step="100"
              [ngModel]="a.delay"
              [disabled]="!canEdit()"
              (change)="patch(a.id, { delay: num($any($event.target).value, a.delay) })"
            />
          </label>
        }
        @if (canEdit()) {
          <div class="order">
            <button class="btn" [disabled]="!canMove(a.id, -1)" (click)="move(a.id, -1)">
              <dd-icon name="arrow_upward" />Earlier
            </button>
            <button class="btn" [disabled]="!canMove(a.id, 1)" (click)="move(a.id, 1)">
              <dd-icon name="arrow_downward" />Later
            </button>
          </div>
        }
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .add {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        width: 100%;
        height: 32px;
        margin: 4px 0 8px;
        border-radius: 8px;
        border: 1px solid var(--dd-primary);
        background: var(--dd-primary);
        color: #fff;
        font: inherit;
        font-weight: 600;
        cursor: pointer;
      }
      .add:disabled {
        opacity: 0.45;
        cursor: default;
      }
      .hint,
      .sum {
        margin: 6px 4px 10px;
        color: var(--dd-text-muted);
        line-height: 1.45;
        font-size: 12px;
      }
      .sum {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .rows {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .mark {
        margin: 8px 4px 2px;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--dd-text-muted);
      }
      .row {
        display: grid;
        grid-template-columns: 22px minmax(0, 1fr) auto;
        align-items: center;
        gap: 8px;
        padding: 6px 6px 6px 8px;
        border-radius: 8px;
        border: 1px solid transparent;
        cursor: pointer;
      }
      .row:hover {
        background: var(--dd-surface-2);
      }
      .row.sel {
        background: var(--dd-primary-weak);
        border-color: color-mix(in srgb, var(--dd-primary) 40%, transparent);
      }
      .row.gone {
        opacity: 0.55;
      }
      .idx {
        width: 20px;
        height: 20px;
        border-radius: 50%;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        font-weight: 700;
        background: var(--dd-surface-2);
        color: var(--dd-text-muted);
      }
      .row.sel .idx {
        background: var(--dd-primary);
        color: #fff;
      }
      .what {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 600;
      }
      .how {
        font-size: 11px;
        color: var(--dd-text-muted);
      }
      .icon {
        width: 24px;
        height: 24px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: none;
        border-radius: 6px;
        background: transparent;
        color: var(--dd-text-muted);
        cursor: pointer;
      }
      .icon:hover {
        background: var(--dd-surface-2);
        color: var(--dd-text);
      }
      .link {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        border: none;
        background: transparent;
        color: var(--dd-primary);
        font: inherit;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        padding: 2px 0;
      }
      .detail {
        margin-top: 10px;
        padding-top: 12px;
        border-top: 1px solid var(--dd-border);
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-bottom: 10px;
      }
      .field > span {
        font-size: 11px;
        color: var(--dd-text-muted);
      }
      .two {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }
      input[type='number'] {
        font: inherit;
        height: 34px;
        color: var(--dd-text);
        background: var(--dd-surface-2);
        border: 1px solid var(--dd-border);
        border-radius: var(--dd-radius-sm);
        padding: 6px 8px;
        box-sizing: border-box;
        width: 100%;
      }
      .order {
        display: flex;
        gap: 6px;
      }
      .btn {
        flex: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        height: 30px;
        border-radius: 8px;
        border: 1px solid var(--dd-border);
        background: var(--dd-surface-2);
        color: var(--dd-text);
        font: inherit;
        font-weight: 600;
        cursor: pointer;
      }
      .btn:disabled {
        opacity: 0.45;
        cursor: default;
      }
    `,
  ],
})
export class AnimationPaneComponent {
  /** The slide (frame) whose animations are listed. */
  readonly slide = input.required<CanvasElementModel>();
  /** Preview the slide: the panel runs it in present mode. */
  readonly play = output<void>();

  private readonly store = inject(ProjectStore);

  protected readonly canEdit = this.store.canEdit;
  protected readonly kindOptions = KIND_OPTIONS;
  protected readonly triggerOptions = TRIGGER_OPTIONS;
  protected readonly directions = DIRECTION_OPTIONS;
  protected readonly exitDirections = EXIT_DIRECTION_OPTIONS;
  protected readonly effectFor = effectFor;

  private readonly selectedId_ = signal<string | null>(null);

  /** What is on the slide, by id. */
  private readonly targets = computed(() => {
    const c = contentForFrame(
      this.slide().id,
      true,
      this.store.elements(),
      this.store.tables(),
      this.store.sequenceDiagrams(),
      this.store.lifelines(),
      this.store.sequenceMessages(),
    );
    const out = new Map<string, Target>();
    for (const e of c.elements) {
      if (e.type === 'frame') {
        continue;
      }
      const text = (e.text ?? '').trim().replace(/\s+/g, ' ');
      out.set(e.id, {
        label: text ? text.slice(0, 32) : (TYPE_NAMES[e.type] ?? e.type),
        kind: 'element',
        x: e.x,
        y: e.y,
      });
    }
    for (const t of c.tables) {
      out.set(t.id, { label: t.name || 'Table', kind: 'table', x: t.x, y: t.y });
    }
    for (const d of c.diagrams) {
      out.set(d.id, {
        label: d.title?.trim() || 'Sequence diagram',
        kind: 'diagram',
        x: 0,
        y: d.originY,
      });
    }
    return out;
  });

  /** The slide's animations in play order (derived from old build steps until first edited). */
  private readonly list = computed<SlideAnimation[]>(() =>
    slideAnimations(
      this.slide().slide,
      this.store.elements().filter((e) => e.slideId === this.slide().id && e.type !== 'frame'),
    ),
  );

  protected readonly rows = computed(() => {
    const targets = this.targets();
    let click = 0;
    return this.list().map((animation) => {
      if (animation.trigger === 'click') {
        click += 1;
      }
      return { animation, target: targets.get(animation.target) ?? null, click };
    });
  });

  protected readonly selected = computed(
    () => this.list().find((a) => a.id === this.selectedId_()) ?? null,
  );
  protected readonly selectedId = computed(() => this.selected()?.id ?? null);

  protected readonly effectOptions = computed<SelectOption<SlideAnimationEffect>[]>(() => {
    const a = this.selected();
    if (!a) {
      return [];
    }
    return SLIDE_ANIMATION_EFFECTS_BY_KIND[a.kind].map((value) => ({
      value,
      label: EFFECT_NAMES[a.kind][value],
    }));
  });

  /** Objects selected on the canvas that belong to this slide, in reading order. */
  protected readonly selectedTargets = computed(() => {
    const targets = this.targets();
    const ids = [
      ...this.store.selectedElementIds(),
      ...this.store.selectedTableIds(),
      ...this.store.selectedDiagramIds(),
    ].filter((id) => targets.has(id));
    return [...new Set(ids)].sort((a, b) => {
      const p = targets.get(a)!;
      const q = targets.get(b)!;
      return p.y - q.y || p.x - q.x;
    });
  });

  protected readonly summary = computed(() => {
    const plan = planAnimations(this.list(), new Set(this.targets().keys()));
    const clicks = plan.groups.filter((g) => !g.auto).length;
    const auto = plan.groups.some((g) => g.auto);
    const parts = [`${clicks} click${clicks === 1 ? '' : 's'}`];
    if (auto) {
      parts.push('starts by itself');
    }
    return parts.join(' · ');
  });

  protected effectName(a: SlideAnimation): string {
    return EFFECT_NAMES[a.kind][a.effect];
  }

  protected directional(a: SlideAnimation): boolean {
    return DIRECTIONAL_EFFECTS.has(a.effect);
  }

  protected num(raw: string, fallback: number): number {
    const n = Math.round(Number(raw));
    return Number.isFinite(n) ? Math.max(0, n) : fallback;
  }

  /** Select a row, and its object on the canvas so it can be seen and moved. */
  protected pickRow(a: SlideAnimation): void {
    this.selectedId_.set(a.id);
    const t = this.targets().get(a.target);
    if (!t) {
      return;
    }
    this.store.setSelection(
      t.kind === 'table' ? [a.target] : [],
      [],
      t.kind === 'element' ? [a.target] : [],
      [],
      [],
      t.kind === 'diagram' ? [a.target] : [],
    );
  }

  protected addSelected(): void {
    const ids = this.selectedTargets();
    if (!ids.length) {
      return;
    }
    const added = ids.map((id) => newAnimation(id));
    void this.commit([...this.list(), ...added]);
    this.selectedId_.set(added[added.length - 1].id);
  }

  protected remove(id: string): void {
    void this.commit(this.list().filter((a) => a.id !== id));
  }

  protected patch(id: string, change: Partial<SlideAnimation>): void {
    void this.commit(this.list().map((a) => (a.id === id ? { ...a, ...change } : a)));
  }

  protected canMove(id: string, by: -1 | 1): boolean {
    const i = this.list().findIndex((a) => a.id === id);
    return i >= 0 && i + by >= 0 && i + by < this.list().length;
  }

  protected move(id: string, by: -1 | 1): void {
    const next = [...this.list()];
    const i = next.findIndex((a) => a.id === id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= next.length) {
      return;
    }
    [next[i], next[j]] = [next[j], next[i]];
    void this.commit(next);
  }

  /**
   * Save the list on the slide. The first edit of a slide that still carries old build
   * steps also clears them, so the explicit list is the only source from then on.
   */
  private async commit(next: SlideAnimation[]): Promise<void> {
    const frame = this.slide();
    if (!frame.slide || !this.store.canEdit()) {
      return;
    }
    const valid = new Set(this.targets().keys());
    const cleaned = normalizeAnimations(next.filter((a) => valid.has(a.target)));
    const legacy =
      frame.slide.animations === undefined
        ? this.store
            .elements()
            .filter((e) => e.slideId === frame.id && (e.step ?? 0) > 0)
        : [];
    await this.store.batchHistory(async () => {
      await this.store.updateElement(frame.id, {
        slide: { ...frame.slide!, animations: cleaned },
      });
      for (const e of legacy) {
        await this.store.updateElement(e.id, { step: null });
      }
    });
  }
}
