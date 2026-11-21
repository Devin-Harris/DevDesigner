import { inject, Pipe, type PipeTransform } from '@angular/core';
import type { ProjectSummary } from '@devdesigner/shared';
import { ProjectThumbnailService, type ThumbState } from './services/project-thumbnail.service';

/**
 * `project | thumbState`: the project's card thumbnail. Impure on purpose: reading a stale or
 * missing thumbnail queues its render, and the state changes when it arrives.
 */
@Pipe({ name: 'thumbState', pure: false })
export class ThumbStatePipe implements PipeTransform {
   private readonly thumbs = inject(ProjectThumbnailService);
   transform(project: ProjectSummary): ThumbState {
      return this.thumbs.state(project);
   }
}

/** `iso | editedAgo`: "Edited 5m ago". Impure because it reads the clock. */
@Pipe({ name: 'editedAgo', pure: false })
export class EditedAgoPipe implements PipeTransform {
   transform(iso: string): string {
      const then = new Date(iso).getTime();
      if (Number.isNaN(then)) return '';
      const s = Math.max(0, Math.round((Date.now() - then) / 1000));
      if (s < 60) return 'Edited just now';
      const m = Math.round(s / 60);
      if (m < 60) return `Edited ${m}m ago`;
      const h = Math.round(m / 60);
      if (h < 24) return `Edited ${h}h ago`;
      const d = Math.round(h / 24);
      if (d < 30) return `Edited ${d}d ago`;
      return `Edited ${new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
   }
}
