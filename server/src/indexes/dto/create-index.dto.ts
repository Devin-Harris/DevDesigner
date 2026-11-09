import { ArrayNotEmpty, IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import type { CreateIndexDto as ICreateIndexDto } from '@devdesigner/shared';

/** Body for POST /tables/:tableId/indexes. */
export class CreateIndexDto implements ICreateIndexDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  columnIds!: string[];

  @IsOptional()
  @IsBoolean()
  isUnique?: boolean;
}
