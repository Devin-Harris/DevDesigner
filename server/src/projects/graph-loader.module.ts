import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from './project.entity';
import { GraphLoaderService } from './graph-loader.service';
import { TableEntity } from '../tables/table.entity';
import { RelationshipEntity } from '../relationships/relationship.entity';
import { ElementEntity } from '../elements/element.entity';
import { SequenceDiagramEntity } from '../sequence/sequence-diagram.entity';
import { LifelineEntity } from '../sequence/lifeline.entity';
import { SequenceMessageEntity } from '../sequence/sequence-message.entity';

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
