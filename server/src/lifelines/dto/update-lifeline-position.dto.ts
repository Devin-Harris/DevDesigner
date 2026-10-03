import { IsNumber } from 'class-validator';

export class UpdateLifelinePositionDto {
  @IsNumber()
  x!: number;
}
