import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from '../projects/project.entity';
import { SequenceMessageEntity } from './sequence-message.entity';
import { SequenceMessagesController } from './sequence-messages.controller';
import { SequenceMessagesService } from './sequence-messages.service';

@Module({
  imports: [TypeOrmModule.forFeature([SequenceMessageEntity, Project])],
  controllers: [SequenceMessagesController],
  providers: [SequenceMessagesService],
  exports: [SequenceMessagesService],
})
export class SequenceMessagesModule {}
