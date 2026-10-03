import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateLifelineDto {
  @IsString()
  label!: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsNumber()
  x!: number;

  @IsOptional()
  @IsNumber()
  width?: number;

  @IsOptional()
  @IsNumber()
  order?: number;
}
