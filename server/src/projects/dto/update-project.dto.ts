import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import type { UpdateProjectDto as IUpdateProjectDto } from '@dbdesigner/shared';

/** Body for PATCH /projects/:id. All fields optional; only what changed is sent. */
export class UpdateProjectDto implements IUpdateProjectDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}
