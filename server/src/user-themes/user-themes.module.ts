import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserThemeEntity } from './user-theme.entity';
import { UserThemesController } from './user-themes.controller';
import { UserThemesService } from './user-themes.service';

/** Personal theme libraries ("My themes"). */
@Module({
  imports: [TypeOrmModule.forFeature([UserThemeEntity])],
  controllers: [UserThemesController],
  providers: [UserThemesService],
})
export class UserThemesModule {}
