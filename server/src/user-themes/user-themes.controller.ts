import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import type { UserThemeResponse } from '@devdesigner/shared';
import { CallerScoped } from '../access/access-policy';
import { Caller } from '../platform/http/caller';
import { SaveUserThemeDto } from './dto/save-user-theme.dto';
import { UserThemesService } from './user-themes.service';

/** The caller's personal theme library ("My themes"), shared across their projects. */
@Controller('me/themes')
@CallerScoped()
export class UserThemesController {
  constructor(private readonly themes: UserThemesService) {}

  @Get()
  list(@Caller() caller: Caller): Promise<UserThemeResponse[]> {
    return this.themes.list(caller.ownerId);
  }

  @Post()
  save(@Body() dto: SaveUserThemeDto, @Caller() caller: Caller): Promise<UserThemeResponse> {
    return this.themes.save(caller.ownerId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @Caller() caller: Caller): Promise<void> {
    return this.themes.remove(caller.ownerId, id);
  }
}
