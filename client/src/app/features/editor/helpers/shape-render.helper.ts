// Compatibility re-export: the renderer now lives in ./render (pass 3.2). Only
// core/sandbox/sandbox-backend.service.ts still imports this path (it is being edited
// concurrently); point it at ./render and delete this file.
export * from './render';
