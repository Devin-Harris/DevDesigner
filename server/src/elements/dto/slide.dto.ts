import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  SLIDE_DIRECTIONS,
  SLIDE_EASINGS,
  SLIDE_TRANSITION_TYPES,
  type SlideConfig,
  type SlideDirection,
  type SlideEasing,
  type SlideTransition,
  type SlideTransitionType,
} from '@dbdesigner/shared';

/** The transition into a slide: type, direction, duration (ms) and easing. */
export class SlideTransitionDto implements SlideTransition {
  @IsIn([...SLIDE_TRANSITION_TYPES])
  type!: SlideTransitionType;

  @IsOptional()
  @IsIn([...SLIDE_DIRECTIONS])
  direction?: SlideDirection;

  @IsNumber()
  @Min(0)
  @Max(10000)
  duration!: number;

  @IsIn([...SLIDE_EASINGS])
  easing!: SlideEasing;
}

/** A frame's place in the slide sequence plus its transition and notes. */
export class SlideDto implements SlideConfig {
  @IsNumber()
  order!: number;

  @IsOptional()
  @IsBoolean()
  hidden?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  notes?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => SlideTransitionDto)
  transition?: SlideTransition;
}
