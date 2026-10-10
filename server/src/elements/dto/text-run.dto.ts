import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import type { TextRun } from '@dbdesigner/shared';

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
  @IsString()
  @MaxLength(64)
  color?: string;
}
