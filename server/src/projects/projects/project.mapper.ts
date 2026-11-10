import type { ProjectSummary, SlideTheme } from '@devdesigner/shared';
import type { Project } from './project.entity';

/** The dashboard / graph summary of a project row. */
export function toProjectSummary(project: Project): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    archived: project.archived,
    type: project.type,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

/** The stored custom theme library (bad or missing JSON reads as none). */
export function parseThemes(json: string | null): SlideTheme[] {
  if (!json) return [];
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? (v as SlideTheme[]) : [];
  } catch {
    return [];
  }
}
