import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ColumnEntity } from '../columns/column.entity';
import { RelationshipEntity } from './relationship.entity';
import { RelationshipsController } from './relationships.controller';
import { RelationshipsService } from './relationships.service';

/**
 * Relationships feature module. Exports RelationshipsService so ProjectsModule
 * can include relationships in the full project graph.
 */
@Module({
  imports: [TypeOrmModule.forFeature([RelationshipEntity, ColumnEntity])],
  controllers: [RelationshipsController],
  providers: [RelationshipsService],
  exports: [RelationshipsService],
})
export class RelationshipsModule {}
