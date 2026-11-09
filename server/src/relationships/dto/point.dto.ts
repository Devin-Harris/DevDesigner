import { IsNumber } from 'class-validator';
import type { PointModel } from '@devdesigner/shared';

/** A 2D point used for relationship waypoints. */
export class PointDto implements PointModel {
  @IsNumber()
  x!: number;

  @IsNumber()
  y!: number;
}
