import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  PROJECT_TYPES,
  type UpdateProjectDto as IUpdateProjectDto,
  type ProjectType,
} from '@dbdesigner/shared';

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

  @IsOptional()
  @IsIn(PROJECT_TYPES)
  type?: ProjectType;
}
