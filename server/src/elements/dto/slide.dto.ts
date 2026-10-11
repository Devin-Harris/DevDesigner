import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
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
  MAX_ANIMATION_DELAY,
  MAX_ANIMATION_DURATION,
  MAX_SLIDE_ANIMATIONS,
  MORPH_BY_OPTIONS,
  type MorphBy,
  SLIDE_ANIMATION_EFFECTS,
  SLIDE_ANIMATION_KINDS,
  SLIDE_ANIMATION_TRIGGERS,
  SLIDE_DIRECTIONS,
  SLIDE_EASINGS,
  SLIDE_TRANSITION_TYPES,
  type SlideAnimation,
  type SlideAnimationEffect,
  type SlideAnimationKind,
  type SlideAnimationTrigger,
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

  @IsOptional()
  @IsIn([...MORPH_BY_OPTIONS])
  morphBy?: MorphBy;
}

/** One object animation on a slide. */
export class SlideAnimationDto implements SlideAnimation {
  @IsString()
  @MaxLength(100)
  id!: string;

  @IsString()
  @MaxLength(100)
  target!: string;

  @IsIn([...SLIDE_ANIMATION_KINDS])
  kind!: SlideAnimationKind;

  @IsIn([...SLIDE_ANIMATION_EFFECTS])
  effect!: SlideAnimationEffect;

  @IsIn([...SLIDE_ANIMATION_TRIGGERS])
  trigger!: SlideAnimationTrigger;

  @IsNumber()
  @Min(0)
  @Max(MAX_ANIMATION_DURATION)
  duration!: number;

  @IsNumber()
  @Min(0)
  @Max(MAX_ANIMATION_DELAY)
  delay!: number;

  @IsOptional()
  @IsIn([...SLIDE_DIRECTIONS])
  direction?: SlideDirection;
}

/** A frame's place in the slide sequence plus its transition and notes. */
export class SlideDto implements SlideConfig {
  @IsNumber()
  order!: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  presentation?: string;

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

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_SLIDE_ANIMATIONS)
  @ValidateNested({ each: true })
  @Type(() => SlideAnimationDto)
  animations?: SlideAnimation[];
}
