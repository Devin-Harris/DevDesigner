import { IsBoolean, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import type { CreateSequenceMessageDto as ICreateSequenceMessageDto } from '@devdesigner/shared';
import { IsColor } from '../../../common/validators';

const STYLES = ['solid', 'dashed', 'break'] as const;
const DIRECTIONS = ['forward', 'reverse'] as const;
const ARROWHEADS = ['arrow', 'open', 'none'] as const;

/** Body for POST /projects/:projectId/messages. */
export class CreateSequenceMessageDto implements ICreateSequenceMessageDto {
  @IsString()
  @IsNotEmpty()
  diagramId!: string;

  @IsString()
  fromLifelineId!: string;

  @IsString()
  toLifelineId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;

  @IsNumber()
  y!: number;

  @IsOptional()
  @IsIn(STYLES)
  style?: (typeof STYLES)[number];

  @IsOptional()
  @IsIn(DIRECTIONS)
  direction?: (typeof DIRECTIONS)[number];

  @IsOptional()
  @IsIn(ARROWHEADS)
  arrowhead?: (typeof ARROWHEADS)[number];

  @IsOptional()
  @IsColor()
  @MaxLength(20)
  color?: string;

  @IsOptional()
  @IsBoolean()
  wrap?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  morphId?: string;
}
