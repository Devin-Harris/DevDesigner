import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { LaserService } from '../../../core/services/laser.service';
import { ProjectStore } from '../../../stores/project.store';

/** Every laser is red, regardless of whose it is. */
const LASER_COLOR = '#ff2d2d';

interface LaserSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  opacity: number;
  width: number;
}

interface LaserDraw {
  id: string;
  color: string;
  segments: LaserSegment[];
  head: { x: number; y: number } | null;
}

/**
 * Screen-space overlay that paints laser-pointer trails (ours and other
 * participants'). Purely presentational and pointer-transparent: it reads the
 * ephemeral LaserService state and projects it through the project viewport.
 */
@Component({
  selector: 'app-laser-layer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './laser-layer.component.html',
  styleUrl: './laser-layer.component.scss',
})
export class LaserLayerComponent {
  private readonly store = inject(ProjectStore);
  private readonly laser = inject(LaserService);

  protected readonly lasers = computed<LaserDraw[]>(() => {
    const v = this.store.viewport();
    const project = (p: { x: number; y: number }) => ({
      x: p.x * v.zoom + v.x,
      y: p.y * v.zoom + v.y,
    });
    return this.laser.views().map((view) => {
      const pts = view.points.map((p) => ({ ...project(p), age: p.age, start: p.start }));
      const segments: LaserSegment[] = [];
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        if (b.start) {
          continue;
        }
        const life = 1 - (a.age + b.age) / 2;
        segments.push({
          x1: a.x,
          y1: a.y,
          x2: b.x,
          y2: b.y,
          opacity: Math.max(0, life),
          width: 2 + 4 * life,
        });
      }
      return {
        id: view.id,
        color: LASER_COLOR,
        segments,
        head: view.head ? project(view.head) : null,
      };
    });
  });
}
