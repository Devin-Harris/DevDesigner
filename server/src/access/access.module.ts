import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from '../projects/project.entity';
import { ShareLink } from '../sharing/share-link.entity';
import { AccessService } from './access.service';
import { EntityProjectResolver } from './entity-project-resolver';
import { ProjectAccessGuard } from './project-access.guard';

/**
 * Access-resolution and policy layer (BUILD_INSTRUCTIONS.md sections 6 and 7).
 *
 * Provides AccessService (the caller's level on a project), EntityProjectResolver
 * (child id -> project) and ProjectAccessGuard, which `@RequiresAccess` installs on
 * routes. Marked @Global so every feature module's routes can use the guard.
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([Project, ShareLink]),
  ],
  providers: [AccessService, EntityProjectResolver, ProjectAccessGuard],
  exports: [AccessService, EntityProjectResolver, ProjectAccessGuard],
})
export class AccessModule {}
