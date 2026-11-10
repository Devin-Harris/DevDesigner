import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import type { CreateIndexDto as ICreateIndexDto } from '@devdesigner/shared';
import { MAX_ID_LENGTH, MAX_INDEX_COLUMNS } from '../../common/limits';

/** Body for POST /tables/:tableId/indexes. */
export class CreateIndexDto implements ICreateIndexDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_INDEX_COLUMNS)
  @IsString({ each: true })
  @MaxLength(MAX_ID_LENGTH, { each: true })
  columnIds!: string[];

  @IsOptional()
  @IsBoolean()
  isUnique?: boolean;
}
