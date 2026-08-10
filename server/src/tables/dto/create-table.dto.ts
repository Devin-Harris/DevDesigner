import { IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import type { CreateTableDto as ICreateTableDto } from '@dbdesigner/shared';

/** Body for POST /projects/:projectId/tables. */
export class CreateTableDto implements ICreateTableDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsNumber()
  x!: number;

  @IsNumber()
  y!: number;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  color?: string;
}
