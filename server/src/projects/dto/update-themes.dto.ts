import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, ValidateNested } from 'class-validator';
import type { SlideTheme, UpdateThemesDto as IUpdateThemesDto } from '@dbdesigner/shared';
import { SlideThemeDto } from '../../elements/dto/slide.dto';

/** Body for PUT /projects/:projectId/themes: the whole custom theme library. */
export class UpdateThemesDto implements IUpdateThemesDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SlideThemeDto)
  themes!: SlideTheme[];
}
