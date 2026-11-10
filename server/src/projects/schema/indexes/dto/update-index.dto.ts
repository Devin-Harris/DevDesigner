import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import type { UpdateIndexDto as IUpdateIndexDto } from '@devdesigner/shared';
import { MAX_ID_LENGTH, MAX_INDEX_COLUMNS } from '../../../common/limits';

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
  @ArrayMaxSize(MAX_INDEX_COLUMNS)
  @IsString({ each: true })
  @MaxLength(MAX_ID_LENGTH, { each: true })
  columnIds?: string[];

  @IsOptional()
  @IsBoolean()
  isUnique?: boolean;
}
