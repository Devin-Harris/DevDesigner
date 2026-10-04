import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from '../projects/project.entity';
import { LifelineEntity } from './lifeline.entity';
import { SequenceMessageEntity } from './sequence-message.entity';
import { SequenceDiagramEntity } from './sequence-diagram.entity';
import { SequenceController } from './sequence.controller';
import { SequenceService } from './sequence.service';

/**
 * Sequence-diagram feature module. Exports SequenceService so ProjectsModule can
 * assemble diagrams/lifelines/messages into the full project graph on load.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      SequenceDiagramEntity,
      LifelineEntity,
      SequenceMessageEntity,
      Project,
    ]),
  ],
  controllers: [SequenceController],
  providers: [SequenceService],
  exports: [SequenceService],
})
export class SequenceModule {}
