import { IsArray, IsInt, IsOptional, IsString, Min } from 'class-validator';
import type { DataType } from '@dbdesigner/shared';

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
  @IsString({ each: true })
  args?: string[];
}
