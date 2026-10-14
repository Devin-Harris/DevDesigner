import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import type { UpdateColumnDto as IUpdateColumnDto } from '@dbdesigner/shared';
import { DataTypeDto } from './data-type.dto';

/** Body for PATCH /columns/:columnId. All fields optional. */
export class UpdateColumnDto implements IUpdateColumnDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DataTypeDto)
  dataType?: DataTypeDto;

  @IsOptional()
  @IsBoolean()
  isPrimaryKey?: boolean;

  @IsOptional()
  @IsBoolean()
  isNullable?: boolean;

  @IsOptional()
  @IsBoolean()
  isUnique?: boolean;

  @IsOptional()
  @IsBoolean()
  isAutoIncrement?: boolean;

  @IsOptional()
  @IsBoolean()
  isUnsigned?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  defaultValue?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
