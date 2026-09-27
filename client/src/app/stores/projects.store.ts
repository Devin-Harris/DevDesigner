import { computed, inject } from '@angular/core';
import {
  patchState,
  signalStore,
  withComputed,
  withMethods,
  withState,
} from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { catchError, firstValueFrom, of, pipe, switchMap, tap } from 'rxjs';
import type {
  CreateProjectDto,
  ProjectSummary,
  ProjectType,
  UpdateProjectDto,
} from '@dbdesigner/shared';
import { ProjectsService } from '../core/services/projects.service';

/** Workspace type filter: a single project type, or all of them. */
export type ProjectTypeFilter = ProjectType | 'ALL';

/**
 * Workspace state: the project list plus the current selection, search term, and archived
 * filter. Mutations go through the granular ProjectsService and update local
 * state optimistically so the grid stays responsive (BUILD_INSTRUCTIONS.md
 * sections 8.1 and 8.4).
 */
interface ProjectsState {
  projects: ProjectSummary[];
  loading: boolean;
  error: string | null;
  search: string;
  showArchived: boolean;
  typeFilter: ProjectTypeFilter;
  selectedId: string | null;
}

const initialState: ProjectsState = {
  projects: [],
  loading: false,
  error: null,
  search: '',
  showArchived: false,
  typeFilter: 'ALL',
  selectedId: null,
};

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return 'Something went wrong. Please try again.';
}

export const ProjectsStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed(({ projects, search, typeFilter, selectedId }) => ({
    /** Projects filtered by the current type filter and search term. */
    visibleProjects: computed(() => {
      const term = search().trim().toLowerCase();
      const type = typeFilter();
      return projects().filter((p) => {
        if (type !== 'ALL' && p.type !== type) {
          return false;
        }
        if (!term) {
          return true;
        }
        return (
          p.name.toLowerCase().includes(term) ||
          (p.description ?? '').toLowerCase().includes(term)
        );
      });
    }),
    /** The currently open/selected project, for the top-bar breadcrumb. */
    selected: computed(() => projects().find((p) => p.id === selectedId()) ?? null),
    /** Count per type for the filter chips (over all loaded projects). */
    typeCounts: computed(() => {
      const counts = { ALL: 0, ERD: 0, FLOW: 0, SCRATCH: 0 } as Record<ProjectTypeFilter, number>;
      for (const p of projects()) {
        counts.ALL++;
        counts[p.type]++;
      }
      return counts;
    }),
  })),
  withMethods((store, service = inject(ProjectsService)) => ({
    /** Load projects for the current archived filter. Call with no argument. */
    loadProjects: rxMethod<void>(
      pipe(
        tap(() => patchState(store, { loading: true, error: null })),
        switchMap(() =>
          service.list(store.showArchived()).pipe(
            tap((projects) => patchState(store, { projects, loading: false })),
            catchError((err) => {
              patchState(store, { loading: false, error: errorMessage(err) });
              return of([] as ProjectSummary[]);
            }),
          ),
        ),
      ),
    ),
  })),
  withMethods((store, service = inject(ProjectsService)) => ({
    setSearch(search: string): void {
      patchState(store, { search });
    },

    setTypeFilter(typeFilter: ProjectTypeFilter): void {
      patchState(store, { typeFilter });
    },

    select(selectedId: string | null): void {
      patchState(store, { selectedId });
    },

    /** Change a project's organizational type (breadcrumb chip / card tag). */
    async setType(id: string, type: ProjectType): Promise<void> {
      const updated = await firstValueFrom(service.update(id, { type }));
      patchState(store, {
        projects: store.projects().map((p) => (p.id === id ? updated : p)),
      });
    },

    toggleArchived(): void {
      patchState(store, { showArchived: !store.showArchived() });
      store.loadProjects();
    },

    async create(dto: CreateProjectDto): Promise<ProjectSummary> {
      const created = await firstValueFrom(service.create(dto));
      // A new project is not archived; only surface it in the active view.
      if (!store.showArchived()) {
        patchState(store, { projects: [created, ...store.projects()] });
      }
      return created;
    },

    async rename(id: string, dto: UpdateProjectDto): Promise<void> {
      const updated = await firstValueFrom(service.update(id, dto));
      patchState(store, {
        projects: store.projects().map((p) => (p.id === id ? updated : p)),
      });
    },

    async duplicate(id: string): Promise<void> {
      const copy = await firstValueFrom(service.duplicate(id));
      if (copy.archived === store.showArchived()) {
        patchState(store, { projects: [copy, ...store.projects()] });
      }
    },

    async setArchived(id: string, archived: boolean): Promise<void> {
      await firstValueFrom(service.update(id, { archived }));
      // Toggling archived moves the project out of the current filtered view.
      patchState(store, {
        projects: store.projects().filter((p) => p.id !== id),
      });
    },

    async remove(id: string): Promise<void> {
      await firstValueFrom(service.remove(id));
      patchState(store, {
        projects: store.projects().filter((p) => p.id !== id),
        selectedId: store.selectedId() === id ? null : store.selectedId(),
      });
    },
  })),
);
