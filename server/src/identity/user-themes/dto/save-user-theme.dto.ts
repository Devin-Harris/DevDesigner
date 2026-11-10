import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';
import type { SaveUserThemeDto as ISaveUserThemeDto, SlideTheme } from '@devdesigner/shared';
import { SlideThemeDto } from '../../../projects/canvas/elements/dto/slide.dto';

/** Body for POST /me/themes. */
export class SaveUserThemeDto implements ISaveUserThemeDto {
  @ValidateNested()
  @Type(() => SlideThemeDto)
  theme!: SlideTheme;
}
