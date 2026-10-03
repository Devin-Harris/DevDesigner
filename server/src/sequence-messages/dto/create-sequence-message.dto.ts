import { IsIn, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateSequenceMessageDto {
  @IsString()
  fromLifelineId!: string;

  @IsString()
  toLifelineId!: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsNumber()
  y!: number;

  @IsOptional()
  @IsIn(['solid', 'dashed'])
  style?: 'solid' | 'dashed';

  @IsOptional()
  @IsIn(['forward', 'reverse'])
  direction?: 'forward' | 'reverse';

  @IsOptional()
  @IsIn(['arrow', 'open', 'none'])
  arrowhead?: 'arrow' | 'open' | 'none';
}
