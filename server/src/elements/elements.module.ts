import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from '../projects/project.entity';
import { ElementEntity } from './element.entity';
import { ElementsController } from './elements.controller';
import { ElementsService } from './elements.service';

/**
 * Canvas-elements feature module (the excalidraw-style drawing layer). Exports
 * ElementsService so ProjectsModule can assemble the full project graph without
 * duplicating query logic.
 */
@Module({
  imports: [TypeOrmModule.forFeature([ElementEntity, Project])],
  controllers: [ElementsController],
  providers: [ElementsService],
  exports: [ElementsService],
})
export class ElementsModule {}
