import { Type } from 'class-transformer';
import { IsNumber, IsObject, IsOptional, ValidateNested } from 'class-validator';
import type { UpdateHomeDto as IUpdateHomeDto } from '@devdesigner/shared';

class HomeViewDto {
  @IsNumber()
  x!: number;

  @IsNumber()
  y!: number;

  @IsNumber()
  zoom!: number;
}

/** Body for PATCH /projects/:projectId/home. `home: null` clears the saved home view. */
export class UpdateHomeDto implements IUpdateHomeDto {
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => HomeViewDto)
  home!: HomeViewDto | null;
}
