import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from '../projects/project.entity';
import { TableEntity } from '../tables/table.entity';
import { ColumnEntity } from '../columns/column.entity';
import { RelationshipEntity } from '../relationships/relationship.entity';
import { ElementEntity } from '../elements/element.entity';
import { ShareLink } from '../sharing/share-link.entity';
import { AccessService } from './access.service';

/**
 * Access-resolution and policy layer (BUILD_INSTRUCTIONS.md sections 6 and 7).
 *
 * Provides AccessService, which resolves the caller's effective access to a
 * project (directly or by walking a child entity's ancestry) and authorizes
 * reads and writes before services mutate anything.
 *
 * Marked @Global so every feature module can inject AccessService without
 * re-importing. Registers the entities it needs to resolve ancestry.
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Project,
      TableEntity,
      ColumnEntity,
      RelationshipEntity,
      ElementEntity,
      ShareLink,
    ]),
  ],
  providers: [AccessService],
  exports: [AccessService],
})
export class AccessModule {}
