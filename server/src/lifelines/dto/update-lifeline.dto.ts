import { IsNumber, IsOptional, IsString } from 'class-validator';

export class UpdateLifelineDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsNumber()
  width?: number;
}
