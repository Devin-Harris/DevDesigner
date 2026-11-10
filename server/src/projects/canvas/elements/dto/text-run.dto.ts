import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import type { TextRun } from '@devdesigner/shared';
import { IsColor } from '../../../common/validators';

/** A styled run of rich text; the runs of an element concatenate to its `text`. */
export class TextRunDto implements TextRun {
  @IsString()
  @MaxLength(50000)
  text!: string;

  @IsOptional()
  @IsBoolean()
  bold?: boolean;

  @IsOptional()
  @IsBoolean()
  italic?: boolean;

  @IsOptional()
  @IsBoolean()
  underline?: boolean;

  @IsOptional()
  @IsColor()
  @MaxLength(64)
  color?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  morph?: string;
}
