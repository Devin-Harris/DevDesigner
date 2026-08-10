import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from '../projects/project.entity';
import { TableEntity } from './table.entity';
import { TablesController } from './tables.controller';
import { TablesService } from './tables.service';

/**
 * Tables feature module. Exports TablesService so ProjectsModule can assemble
 * the full project graph without duplicating query logic.
 */
@Module({
  imports: [TypeOrmModule.forFeature([TableEntity, Project])],
  controllers: [TablesController],
  providers: [TablesService],
  exports: [TablesService],
})
export class TablesModule {}
