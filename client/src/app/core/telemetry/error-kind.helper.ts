import { HttpErrorResponse } from '@angular/common/http';

export type ClientErrorKind = 'uncaught' | 'unhandled_rejection' | 'http' | 'chunk_load';

const CHUNK_LOAD =
   /Loading chunk|ChunkLoadError|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i;

/** Bucket an error for `client.error` (no message or stack ever leaves the browser). */
export function classifyError(error: unknown, fallback: ClientErrorKind = 'uncaught'): ClientErrorKind {
   if (error instanceof HttpErrorResponse) return 'http';
   const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? '');
   return CHUNK_LOAD.test(message) ? 'chunk_load' : fallback;
}
