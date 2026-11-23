import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GraphLoaderModule } from '../../projects/common/graph-loader.module';
import { ShareLink } from './share-link.entity';
import { SharingController } from './sharing.controller';
import { SharingService } from './sharing.service';
import { SharedWithMeService } from './shared-with-me.service';
import { SharedProjectVisit } from './shared-project-visit.entity';
import { Project } from '../../projects/projects/project.entity';

/**
 * Sharing: owner share-link CRUD and the account-free GET /shared/:token entry.
 *
 * Layers (section 7): SharingController (routing + DTO validation only) ->
 * SharingService (business logic, calls the policy layer first) -> TypeORM
 * repository (data access). Imports ProjectsModule to reuse graph assembly for
 * the shared entry route; AccessService comes from the global AccessModule.
 */
@Module({
  imports: [TypeOrmModule.forFeature([ShareLink, SharedProjectVisit, Project]), GraphLoaderModule],
  controllers: [SharingController],
  providers: [SharingService, SharedWithMeService],
})
export class SharingModule {}
