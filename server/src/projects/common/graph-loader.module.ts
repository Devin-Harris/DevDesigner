import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from '../projects/project.entity';
import { GraphLoaderService } from './graph-loader.service';
import { TableEntity } from '../schema/tables/table.entity';
import { RelationshipEntity } from '../schema/relationships/relationship.entity';
import { ElementEntity } from '../canvas/elements/element.entity';
import { SequenceDiagramEntity } from '../canvas/sequence/sequence-diagram.entity';
import { LifelineEntity } from '../canvas/sequence/lifeline.entity';
import { SequenceMessageEntity } from '../canvas/sequence/sequence-message.entity';

/** Project graph reads shared by projects, sharing and export. */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Project,
      TableEntity,
      RelationshipEntity,
      ElementEntity,
      SequenceDiagramEntity,
      LifelineEntity,
      SequenceMessageEntity,
    ]),
  ],
  providers: [GraphLoaderService],
  exports: [GraphLoaderService],
})
export class GraphLoaderModule {}
