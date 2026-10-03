import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from '../projects/project.entity';
import { LifelineEntity } from './lifeline.entity';
import { LifelinesController } from './lifelines.controller';
import { LifelinesService } from './lifelines.service';

@Module({
  imports: [TypeOrmModule.forFeature([LifelineEntity, Project])],
  controllers: [LifelinesController],
  providers: [LifelinesService],
  exports: [LifelinesService],
})
export class LifelinesModule {}
