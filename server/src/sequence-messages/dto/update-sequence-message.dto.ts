import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateSequenceMessageDto {
  @IsOptional()
  @IsString()
  fromLifelineId?: string;

  @IsOptional()
  @IsString()
  toLifelineId?: string;

  @IsOptional()
  @IsString()
  label?: string;

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
