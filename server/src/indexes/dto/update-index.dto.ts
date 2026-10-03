import { ArrayNotEmpty, IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import type { UpdateIndexDto as IUpdateIndexDto } from '@dbdesigner/shared';

/** Body for PATCH /indexes/:indexId. All fields optional (partial update). */
export class UpdateIndexDto implements IUpdateIndexDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  columnIds?: string[];

  @IsOptional()
  @IsBoolean()
  isUnique?: boolean;
}
