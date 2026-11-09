import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import type { UserThemeResponse } from '@devdesigner/shared';
import { CurrentUserId } from '../auth/current-user.decorator';
import { SaveUserThemeDto } from './dto/save-user-theme.dto';
import { UserThemesService } from './user-themes.service';

/** The caller's personal theme library ("My themes"), shared across their projects. */
@Controller('me/themes')
export class UserThemesController {
  constructor(private readonly themes: UserThemesService) {}

  @Get()
  list(@CurrentUserId() ownerId: string | null): Promise<UserThemeResponse[]> {
    return this.themes.list(ownerId);
  }

  @Post()
  save(@Body() dto: SaveUserThemeDto, @CurrentUserId() ownerId: string | null): Promise<UserThemeResponse> {
    return this.themes.save(ownerId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUserId() ownerId: string | null): Promise<void> {
    return this.themes.remove(ownerId, id);
  }
}
