import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ImagesModule } from '../images/images.module';
import { GraphLoaderModule } from './graph-loader.module';
import { Project } from './project.entity';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

/**
 * Projects feature module (BUILD_INSTRUCTIONS.md section 5).
 *
 * Layers (section 7): ProjectsController (routing + DTO validation only) ->
 * ProjectsService (business logic, calls the policy layer once it lands) ->
 * TypeORM repository (data access). Entity and granular DTOs live in this folder.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Project]),
    GraphLoaderModule,
    ImagesModule,
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
