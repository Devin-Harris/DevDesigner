import { Module } from '@nestjs/common';

/**
 * Export: generates SQL via the shared pure generator (@dbdesigner/shared/sql) and returns it as text for the selected dialect.
 *
 * Layers (section 7): ExportController (routing + DTO validation only) ->
 * ExportService (business logic, rules, calls the policy layer first) ->
 * TypeORM repository (data access). Entity and granular DTOs live in this folder.
 */
@Module({})
export class ExportModule {}
