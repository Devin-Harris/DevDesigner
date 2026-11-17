import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';
import type { ElementBinding } from '@devdesigner/shared';

/** Where on the target a bound end points (fractions of the target's box). */
export class BindingFocusDto {
  @IsNumber()
  @Min(0)
  @Max(1)
  x!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  y!: number;
}

/** A line/arrow endpoint bound to a shape, ERD table, or sequence message label. */
export class BindingDto implements ElementBinding {
  @IsIn(['element', 'table', 'message'])
  targetKind!: 'element' | 'table' | 'message';

  @IsString()
  targetId!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => BindingFocusDto)
  focus?: BindingFocusDto;
}
