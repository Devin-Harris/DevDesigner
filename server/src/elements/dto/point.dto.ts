import { IsNumber } from 'class-validator';
import type { PointModel } from '@devdesigner/shared';

/** A 2D point: element vertices (line/arrow/freedraw) and relationship waypoints. */
export class PointDto implements PointModel {
  @IsNumber()
  x!: number;

  @IsNumber()
  y!: number;
}
