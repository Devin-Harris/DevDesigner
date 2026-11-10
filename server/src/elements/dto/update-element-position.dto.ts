import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsNumber, IsOptional, ValidateNested } from 'class-validator';
import type { PointModel, UpdateElementPositionDto as IUpdateElementPositionDto } from '@devdesigner/shared';
import { PointDto } from './point.dto';
import { MAX_ELEMENT_POINTS } from '../../common/limits';

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
  @ArrayMaxSize(MAX_ELEMENT_POINTS)
  @ValidateNested({ each: true })
  @Type(() => PointDto)
  points?: PointModel[];
}
