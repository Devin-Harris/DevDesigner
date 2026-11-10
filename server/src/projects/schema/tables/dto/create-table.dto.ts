import { IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import type { CreateTableDto as ICreateTableDto } from '@devdesigner/shared';
import { IsColor } from '../../../common/validators';

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
  @IsColor()
  @MaxLength(32)
  color?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  slideId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  morphId?: string;
}
