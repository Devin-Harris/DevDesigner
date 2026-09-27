import { Type } from 'class-transformer';
import { IsArray, IsNumber, IsOptional, ValidateNested } from 'class-validator';
import type { PointModel, UpdateElementPositionDto as IUpdateElementPositionDto } from '@dbdesigner/shared';
import { PointDto } from './point.dto';

/** Body for PATCH /elements/:elementId/position (drag/reshape autosave). */
export class UpdateElementPositionDto implements IUpdateElementPositionDto {
  @IsOptional()
  @IsNumber()
  x?: number;

  @IsOptional()
  @IsNumber()
  y?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PointDto)
  points?: PointModel[];
}
