import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import type { DataType } from '@devdesigner/shared';
import { MAX_TYPE_ARGS, MAX_TYPE_ARG_LENGTH } from '../../common/limits';

/** Nested data-type shape used inside column create/update DTOs. */
export class DataTypeDto implements DataType {
  @IsString()
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  length?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TYPE_ARGS)
  @IsString({ each: true })
  @MaxLength(MAX_TYPE_ARG_LENGTH, { each: true })
  args?: string[];
}
