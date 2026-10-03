import { IsArray, IsString } from 'class-validator';

export class ReorderLifelinesDto {
  @IsArray()
  @IsString({ each: true })
  orderedLifelineIds!: string[];
}
