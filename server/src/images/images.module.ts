import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ElementEntity } from '../elements/element.entity';
import { ImagesController } from './images.controller';
import { ImagesService } from './images.service';
import { ProjectImageEntity } from './project-image.entity';

/** Image storage for canvas image elements. */
@Module({
  imports: [TypeOrmModule.forFeature([ProjectImageEntity, ElementEntity])],
  controllers: [ImagesController],
  providers: [ImagesService],
  exports: [ImagesService],
})
export class ImagesModule {}
