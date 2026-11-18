import { Module } from '@nestjs/common';
import { DesktopController } from './desktop.controller';

/** Desktop-app-only control routes (inert unless DESKTOP=true). */
@Module({ controllers: [DesktopController] })
export class DesktopModule {}
