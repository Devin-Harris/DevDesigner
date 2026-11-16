import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ElementEntity } from '../elements/element.entity';
import { ImagesController } from './images.controller';
import { ImagesService } from './images.service';
import { ProjectImageEntity } from './project-image.entity';
import { createMediaStore } from './storage/media-config';
import { MEDIA_STORE } from './storage/media-store';

/** Image / video storage for canvas image elements (metadata in SQLite, bytes in the media store). */
@Module({
  imports: [TypeOrmModule.forFeature([ProjectImageEntity, ElementEntity])],
  controllers: [ImagesController],
  providers: [
    ImagesService,
    {
      provide: MEDIA_STORE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createMediaStore({
          MEDIA_DRIVER: config.get<string>('MEDIA_DRIVER'),
          MEDIA_DIR: config.get<string>('MEDIA_DIR'),
          DATABASE_PATH: config.get<string>('DATABASE_PATH'),
        }),
    },
  ],
  exports: [ImagesService],
})
export class ImagesModule {}
