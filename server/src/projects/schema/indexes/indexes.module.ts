import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TableEntity } from '../tables/table.entity';
import { IndexEntity } from './index.entity';
import { IndexesController } from './indexes.controller';
import { IndexesService } from './indexes.service';

@Module({
  imports: [TypeOrmModule.forFeature([IndexEntity, TableEntity])],
  controllers: [IndexesController],
  providers: [IndexesService],
  exports: [IndexesService],
})
export class IndexesModule {}
