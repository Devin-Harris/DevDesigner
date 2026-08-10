import { Module } from '@nestjs/common';

/**
 * Sharing: owner share-link CRUD, share-token resolution guard, and GET /shared/:token entry for account-free access.
 *
 * Layers (section 7): SharingController (routing + DTO validation only) ->
 * SharingService (business logic, rules, calls the policy layer first) ->
 * TypeORM repository (data access). Entity and granular DTOs live in this folder.
 */
@Module({})
export class SharingModule {}
