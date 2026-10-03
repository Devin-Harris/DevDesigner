import { IsNumber } from 'class-validator';

export class UpdateSequenceMessagePositionDto {
  @IsNumber()
  y!: number;
}
