import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';
import type { SaveUserThemeDto as ISaveUserThemeDto, SlideTheme } from '@dbdesigner/shared';
import { SlideThemeDto } from '../../elements/dto/slide.dto';

/** Body for POST /me/themes. */
export class SaveUserThemeDto implements ISaveUserThemeDto {
  @ValidateNested()
  @Type(() => SlideThemeDto)
  theme!: SlideTheme;
}
