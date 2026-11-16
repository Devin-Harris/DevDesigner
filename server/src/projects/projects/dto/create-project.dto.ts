import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  PROJECT_TYPES,
  type CreateProjectDto as ICreateProjectDto,
  type ProjectType,
} from '@devdesigner/shared';

/** Body for POST /projects. Implements the shared interface so client and server agree. */
export class CreateProjectDto implements ICreateProjectDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsIn(PROJECT_TYPES)
  type?: ProjectType;
}
