import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
   BATCH_RETURN_NONE,
   type BatchUpdateAck,
   type BatchUpdateDto,
   type CloneItemsDto,
   type CreateProjectDto,
   type ImportIntoProjectDto,
   type ImportIntoProjectResponse,
   type ProjectExportFile,
   type ProjectGraphResponse,
   type ProjectSummary,
   type UpdateHomeDto,
   type UpdateThemesDto,
   type UpdateProjectDto,
   type UpdateViewportDto,
} from '@devdesigner/shared';
import { ApiService } from './api.service';

/**
 * Data service for the Projects REST surface (BUILD_INSTRUCTIONS.md section 5).
 * Each method maps to a single granular endpoint; the workspace store owns state
 * and calls these. Payload/response shapes come from the shared package so client
 * and server stay in lockstep.
 */
@Injectable({ providedIn: 'root' })
export class ProjectsService {
   private readonly api = inject(ApiService);

   /** GET /projects?archived= : owner-scoped list (anonymous for now). */
   list(archived = false): Observable<ProjectSummary[]> {
      return this.api.get<ProjectSummary[]>(`/projects?archived=${archived}`);
   }

   /** GET /projects/guest-count : this browser's guest projects (signed in only). */
   guestCount(): Observable<{ count: number }> {
      return this.api.get<{ count: number }>('/projects/guest-count');
   }

   /** POST /projects/claim-guest : move this browser's guest projects into the account. */
   claimGuest(): Observable<{ count: number }> {
      return this.api.post<{ count: number }>('/projects/claim-guest', {});
   }

   /** POST /projects */
   create(dto: CreateProjectDto): Observable<ProjectSummary> {
      return this.api.post<ProjectSummary>('/projects', dto);
   }

   /** PATCH /projects/:id : rename / describe / archive. */
   update(id: string, dto: UpdateProjectDto): Observable<ProjectSummary> {
      return this.api.patch<ProjectSummary>(`/projects/${id}`, dto);
   }

   /** POST /projects/:id/duplicate : deep copy. */
   duplicate(id: string): Observable<ProjectSummary> {
      return this.api.post<ProjectSummary>(`/projects/${id}/duplicate`, {});
   }

   /** GET /projects/:id/export-file : portable snapshot to save as a file. */
   export(id: string): Observable<ProjectExportFile> {
      return this.api.get<ProjectExportFile>(`/projects/${id}/export-file`);
   }

   /** POST /projects/import : create a new project from an exported file. */
   import(file: unknown): Observable<ProjectSummary> {
      return this.api.post<ProjectSummary>('/projects/import', file);
   }

   /** POST /projects/:id/import-content : merge an export file into an existing project. */
   importInto(id: string, dto: ImportIntoProjectDto): Observable<ImportIntoProjectResponse> {
      return this.api.post<ImportIntoProjectResponse>(`/projects/${id}/import-content`, dto);
   }

   /** DELETE /projects/:id */
   remove(id: string): Observable<void> {
      return this.api.delete<void>(`/projects/${id}`);
   }

   /** GET /projects/:id : full project graph (schema + access level) for editor load. */
   getGraph(id: string): Observable<ProjectGraphResponse> {
      return this.api.get<ProjectGraphResponse>(`/projects/${id}`);
   }

   /** PATCH /projects/:id/home : set or clear (null) the shared home view. */
   updateHome(id: string, dto: UpdateHomeDto): Observable<void> {
      return this.api.patch<void>(`/projects/${id}/home`, dto);
   }

   /** PUT /projects/:id/themes : replace the project's custom theme library. */
   updateThemes(id: string, dto: UpdateThemesDto): Observable<void> {
      return this.api.put<void>(`/projects/${id}/themes`, dto);
   }

   /** PATCH /projects/:id/viewport : persist pan/zoom (debounced client-side). */
   updateViewport(id: string, dto: UpdateViewportDto): Observable<void> {
      return this.api.patch<void>(`/projects/${id}/viewport`, dto);
   }

   /**
    * Apply many row patches atomically (PATCH /projects/:id/batch). The store has already
    * applied them locally, so it asks for a small ack instead of every changed row.
    */
   batch(id: string, dto: BatchUpdateDto): Observable<BatchUpdateAck> {
      return this.api.patch<BatchUpdateAck>(`/projects/${id}/batch?return=${BATCH_RETURN_NONE}`, dto);
   }

   /** Copy rows under client-chosen ids in one transaction (POST /projects/:id/clone). */
   clone(id: string, dto: CloneItemsDto): Observable<BatchUpdateAck> {
      return this.api.post<BatchUpdateAck>(`/projects/${id}/clone?return=${BATCH_RETURN_NONE}`, dto);
   }
}
