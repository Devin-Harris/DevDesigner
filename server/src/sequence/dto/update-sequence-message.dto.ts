import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { UpdateSequenceMessageDto as IUpdateSequenceMessageDto } from '@devdesigner/shared';
import { IsColor } from '../../common/validators';

const STYLES = ['solid', 'dashed', 'break'] as const;
const DIRECTIONS = ['forward', 'reverse'] as const;
const ARROWHEADS = ['arrow', 'open', 'none'] as const;

/** Body for PATCH /projects/:projectId/messages/:messageId. */
export class UpdateSequenceMessageDto implements IUpdateSequenceMessageDto {
  @IsOptional()
  @IsString()
  fromLifelineId?: string;

  @IsOptional()
  @IsString()
  toLifelineId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;

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
