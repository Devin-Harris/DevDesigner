import { IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { UpdateTableDto as IUpdateTableDto } from '@devdesigner/shared';
import { IsColor } from '../../../common/validators';

/** Body for PATCH /tables/:tableId (name / color / note). */
export class UpdateTableDto implements IUpdateTableDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsColor()
  @MaxLength(32)
  color?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(4000)
  width?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(8)
  scale?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  groupId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  slideId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  morphId?: string;
}
