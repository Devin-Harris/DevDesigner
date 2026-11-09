import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import type { CreateColumnDto as ICreateColumnDto } from '@devdesigner/shared';
import { DataTypeDto } from './data-type.dto';

/** Body for POST /tables/:tableId/columns. */
export class CreateColumnDto implements ICreateColumnDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ValidateNested()
  @Type(() => DataTypeDto)
  dataType!: DataTypeDto;

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
}
