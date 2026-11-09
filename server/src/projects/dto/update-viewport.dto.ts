import { IsNumber } from 'class-validator';
import type { UpdateViewportDto as IUpdateViewportDto } from '@devdesigner/shared';

/** Body for PATCH /projects/:projectId/viewport (debounced pan/zoom autosave). */
export class UpdateViewportDto implements IUpdateViewportDto {
  @IsNumber()
  viewportX!: number;

  @IsNumber()
  viewportY!: number;

  @IsNumber()
  zoom!: number;
}
