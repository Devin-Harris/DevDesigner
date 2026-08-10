import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import type { CreateProjectDto as ICreateProjectDto } from '@dbdesigner/shared';

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
}
