import { Module } from '@nestjs/common';

/**
 * Notes: free-floating canvas annotations. Create, patch (position/size/content debounced client-side), delete.
 *
 * Layers (section 7): NotesController (routing + DTO validation only) ->
 * NotesService (business logic, rules, calls the policy layer first) ->
 * TypeORM repository (data access). Entity and granular DTOs live in this folder.
 */
@Module({})
export class NotesModule {}
