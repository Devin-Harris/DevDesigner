import { Injectable, computed, signal } from '@angular/core';

/** A dock entry that can be shown/hidden/reordered (Select is always pinned first). */
export type DockToolId =
  | 'hand'
  | 'table'
  | 'sequence'
  | 'grid'
  | 'shape'
  | 'frame'
  | 'slide'
  | 'connector'
  | 'freedraw'
  | 'text'
  | 'code'
  | 'image'
  | 'laser';

/** Where the tool dock sits on the canvas. */
export type DockPosition = 'left' | 'top' | 'right' | 'bottom';

/** A starting set of tools for a kind of work. */
export type DockPreset = 'everything' | 'whiteboard' | 'diagrams' | 'data' | 'slides';

interface DockToolDef {
  id: DockToolId;
  label: string;
  key: string;
  note?: string;
}

const DOCK_TOOLS: readonly DockToolDef[] = [
  { id: 'hand', label: 'Hand / pan', key: 'H' },
  { id: 'shape', label: 'Shape', key: 'R O D', note: 'rect · ellipse · diamond' },
  { id: 'connector', label: 'Arrow + line', key: 'A L', note: 'one button' },
  { id: 'freedraw', label: 'Draw', key: 'P' },
  { id: 'text', label: 'Text', key: 'T' },
  { id: 'table', label: 'ERD table', key: 'E' },
  { id: 'sequence', label: 'Sequence diagram', key: 'Q' },
  { id: 'grid', label: 'Grid table', key: 'G' },
  { id: 'code', label: 'Code block', key: 'C' },
  { id: 'image', label: 'Image + video', key: '', note: 'or paste / drop' },
  { id: 'frame', label: 'Frame', key: 'F' },
  { id: 'slide', label: 'Presentation', key: 'S' },
  { id: 'laser', label: 'Laser pointer', key: 'K' },
];

/** Tools each preset shows (in default order); the rest are hidden. */
const PRESETS: Record<DockPreset, { label: string; tools: readonly DockToolId[] }> = {
  everything: { label: 'Everything', tools: DOCK_TOOLS.map((t) => t.id) },
  whiteboard: { label: 'Whiteboard', tools: ['hand', 'shape', 'connector', 'freedraw', 'text', 'image', 'frame', 'laser'] },
  diagrams: { label: 'Diagrams', tools: ['hand', 'shape', 'connector', 'text', 'sequence', 'code', 'image', 'frame'] },
  data: { label: 'Data model', tools: ['hand', 'table', 'connector', 'text', 'grid', 'code', 'frame'] },
  slides: { label: 'Slides', tools: ['hand', 'slide', 'shape', 'connector', 'text', 'code', 'grid', 'image', 'laser'] },
};

const STORAGE_KEY = 'devdesigner.dockTools';

interface StoredPrefs {
  order: DockToolId[];
  hidden: DockToolId[];
  position?: DockPosition;
  labels?: boolean;
  compact?: boolean;
  twoColumns?: boolean;
  stayOnTool?: boolean;
  fadeWhileDragging?: boolean;
}

/**
 * Per-browser dock customization: which tools appear in the dock and in what
 * order, where the dock sits and how it behaves. Hidden tools stay reachable
 * through their keyboard shortcuts.
 */
@Injectable({ providedIn: 'root' })
export class ToolbarPrefsService {
  private readonly order = signal<DockToolId[]>(DOCK_TOOLS.map((t) => t.id));
  private readonly hidden = signal<ReadonlySet<DockToolId>>(new Set());

  readonly position = signal<DockPosition>('left');
  /** Show each tool's name under its icon. */
  readonly labels = signal(false);
  /** Smaller (32 px) dock buttons. */
  readonly compact = signal(false);
  /** Side dock in two columns (half as tall) instead of one long list. */
  readonly twoColumns = signal(false);
  /** Measured width of a left-side dock (0 when it sits elsewhere), for layouts that avoid it. */
  readonly leftDockWidth = signal(0);
  /** Keep the tool after placing something (else back to Select). */
  readonly stayOnTool = signal(false);
  /** Fade the floating islands while dragging or drawing on the canvas. */
  readonly fadeWhileDragging = signal(true);
  /** The customize panel is open (from the dock or the main menu). */
  readonly panelOpen = signal(false);

  readonly presets = (Object.keys(PRESETS) as DockPreset[]).map((id) => ({ id, label: PRESETS[id].label }));

  /** Every customizable tool, in dock order, with its visibility. */
  readonly allTools = computed(() => {
    const hidden = this.hidden();
    return this.order().map((id) => {
      const def = DOCK_TOOLS.find((t) => t.id === id)!;
      return { ...def, visible: !hidden.has(id) };
    });
  });

  /** The tools the dock shows, in order. */
  readonly visibleTools = computed(() => {
    const hidden = this.hidden();
    return this.order().filter((id) => !hidden.has(id));
  });

  /** The tools the dock leaves out (offered under "More" at the end of the dock). */
  readonly hiddenTools = computed(() => this.allTools().filter((t) => !t.visible));

  /** The preset the current setup matches, if any. */
  readonly activePreset = computed<DockPreset | null>(() => {
    const visible = new Set(this.visibleTools());
    for (const id of Object.keys(PRESETS) as DockPreset[]) {
      const want = PRESETS[id].tools;
      if (want.length === visible.size && want.every((t) => visible.has(t))) return id;
    }
    return null;
  });

  constructor() {
    this.load();
  }

  toggle(id: DockToolId): void {
    const next = new Set(this.hidden());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.hidden.set(next);
    this.save();
  }

  setVisible(id: DockToolId, visible: boolean): void {
    if (this.hidden().has(id) === !visible) return;
    this.toggle(id);
  }

  move(id: DockToolId, delta: number): void {
    const order = [...this.order()];
    const i = order.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    this.order.set(order);
    this.save();
  }

  /** Drop `id` just before `before` (or at the end when null). */
  moveBefore(id: DockToolId, before: DockToolId | null): void {
    if (id === before) return;
    const order = this.order().filter((t) => t !== id);
    const at = before ? order.indexOf(before) : order.length;
    order.splice(at < 0 ? order.length : at, 0, id);
    this.order.set(order);
    this.save();
  }

  applyPreset(preset: DockPreset): void {
    const want = PRESETS[preset].tools;
    const rest = DOCK_TOOLS.map((t) => t.id).filter((id) => !want.includes(id));
    this.order.set([...want, ...rest]);
    this.hidden.set(new Set(rest));
    this.save();
  }

  setPosition(p: DockPosition): void {
    this.position.set(p);
    this.save();
  }

  setFlag(flag: 'labels' | 'compact' | 'twoColumns' | 'stayOnTool' | 'fadeWhileDragging', on: boolean): void {
    this[flag].set(on);
    this.save();
  }

  reset(): void {
    this.order.set(DOCK_TOOLS.map((t) => t.id));
    this.hidden.set(new Set());
    this.position.set('left');
    this.labels.set(false);
    this.compact.set(false);
    this.twoColumns.set(false);
    this.stayOnTool.set(false);
    this.fadeWhileDragging.set(true);
    this.save();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<StoredPrefs>;
      const known = new Set(DOCK_TOOLS.map((t) => t.id));
      // 'arrow' + 'line' merged into one 'connector' button.
      const legacy = (parsed.order ?? []).map((id) => ((id as string) === 'arrow' ? 'connector' : id));
      const order = legacy.filter((id) => known.has(id));
      // Tools added after the prefs were saved go at the end.
      for (const t of DOCK_TOOLS) if (!order.includes(t.id)) order.push(t.id);
      this.order.set(order);
      this.hidden.set(new Set((parsed.hidden ?? []).filter((id) => known.has(id))));
      if (parsed.position && ['left', 'top', 'right', 'bottom'].includes(parsed.position)) this.position.set(parsed.position);
      this.labels.set(!!parsed.labels);
      this.compact.set(!!parsed.compact);
      this.twoColumns.set(!!parsed.twoColumns);
      this.stayOnTool.set(!!parsed.stayOnTool);
      this.fadeWhileDragging.set(parsed.fadeWhileDragging ?? true);
    } catch {
      // Unavailable or corrupt storage: keep the defaults.
    }
  }

  private save(): void {
    try {
      const data: StoredPrefs = {
        order: this.order(),
        hidden: [...this.hidden()],
        position: this.position(),
        labels: this.labels(),
        compact: this.compact(),
        twoColumns: this.twoColumns(),
        stayOnTool: this.stayOnTool(),
        fadeWhileDragging: this.fadeWhileDragging(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Storage unavailable (private mode): the change still applies this session.
    }
  }
}
