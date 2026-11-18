import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from '../../projects/projects/project.entity';
import { ProjectsModule } from '../../projects/projects/projects.module';
import { SyncController } from './sync.controller';
import { SyncForwardInterceptor } from './sync-forward.interceptor';
import { SyncLinkEntity, SyncRemoteEntity } from './sync.entity';
import { SyncRelay } from './sync-relay';
import { SyncService } from './sync.service';

/**
 * Desktop server-backed projects: remotes, links, request forwarding and the relay
 * socket. Routes, timer and forwarding are inert unless DESKTOP=true.
 */
@Module({
  imports: [TypeOrmModule.forFeature([SyncRemoteEntity, SyncLinkEntity, Project]), ProjectsModule],
  controllers: [SyncController],
  providers: [
    SyncService,
    SyncRelay,
    { provide: APP_INTERCEPTOR, useClass: SyncForwardInterceptor },
  ],
})
export class SyncModule {}
