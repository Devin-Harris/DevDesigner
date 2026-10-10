import { IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { UpdateTableDto as IUpdateTableDto } from '@dbdesigner/shared';

/** Body for PATCH /tables/:tableId (name / color / note). */
export class UpdateTableDto implements IUpdateTableDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
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
  @IsString()
  @MaxLength(64)
  groupId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  slideId?: string | null;
}
