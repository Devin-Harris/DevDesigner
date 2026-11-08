import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  MEDIA_CLIP_SHAPES,
  MEDIA_PLAYBACK_MODES,
  type MediaClipShape,
  type MediaConfig,
  type MediaPlayback,
  MAX_ANIMATION_DELAY,
  MAX_ANIMATION_DURATION,
  MAX_SLIDE_ANIMATIONS,
  MORPH_BY_OPTIONS,
  PLACEHOLDER_ROLES,
  LAYOUT_KINDS,
  type LayoutKind,
  type PlaceholderConfig,
  type PlaceholderRole,
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
  type SlideTheme,
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

class MediaCropDto {
  @IsNumber()
  @Min(-100)
  @Max(100)
  x!: number;

  @IsNumber()
  @Min(-100)
  @Max(100)
  y!: number;

  @IsNumber()
  @Min(0.0001)
  @Max(1000)
  width!: number;

  @IsNumber()
  @Min(0.0001)
  @Max(1000)
  height!: number;
}

/** An image element's crop, clip shape and playback. */
export class MediaDto implements MediaConfig {
  @IsOptional()
  @ValidateNested()
  @Type(() => MediaCropDto)
  crop?: MediaConfig['crop'];

  @IsOptional()
  @IsIn(MEDIA_CLIP_SHAPES)
  clip?: MediaClipShape;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10000)
  clipRadius?: number;

  @IsOptional()
  @IsIn(MEDIA_PLAYBACK_MODES)
  playback?: MediaPlayback;

  @IsOptional()
  @IsBoolean()
  loop?: boolean;

  @IsOptional()
  @IsBoolean()
  muted?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(86400)
  start?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(86400)
  end?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  alt?: string;
}

/** A frame's place in the slide sequence plus its transition and notes. */
export class PlaceholderDto implements PlaceholderConfig {
  @IsOptional()
  @IsIn(PLACEHOLDER_ROLES)
  role?: PlaceholderRole;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  prompt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  of?: string;
}

class SlideThemeColorsDto {
  @IsString()
  @MaxLength(32)
  background!: string;

  @IsString()
  @MaxLength(32)
  surface!: string;

  @IsString()
  @MaxLength(32)
  heading!: string;

  @IsString()
  @MaxLength(32)
  text!: string;

  @IsString()
  @MaxLength(32)
  muted!: string;

  @IsString()
  @MaxLength(32)
  accent1!: string;

  @IsString()
  @MaxLength(32)
  accent2!: string;

  @IsString()
  @MaxLength(32)
  accent3!: string;

  @IsString()
  @MaxLength(32)
  accent4!: string;
}

class SlideThemeFontsDto {
  @IsString()
  @MaxLength(32)
  heading!: string;

  @IsString()
  @MaxLength(32)
  body!: string;
}

export class SlideThemeDto implements SlideTheme {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  id?: string;

  @IsOptional()
  @IsIn(['theme', 'layouts', 'design'])
  kind?: SlideTheme['kind'];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  themeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  layoutsId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  designId?: string;

  @IsString()
  @MaxLength(120)
  name!: string;

  @ValidateNested()
  @Type(() => SlideThemeColorsDto)
  colors!: SlideTheme['colors'];

  @ValidateNested()
  @Type(() => SlideThemeFontsDto)
  fonts!: SlideTheme['fonts'];

  /** The theme's own layout designs per kind (kept as given). */
  @IsOptional()
  @IsObject()
  layouts?: SlideTheme['layouts'];

  /** The theme's master items (kept as given). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  master?: SlideTheme['master'];

  /** The theme's non-standard layouts (kept as given). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  extraLayouts?: SlideTheme['extraLayouts'];
}

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

  @IsOptional()
  @IsBoolean()
  layout?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  layoutName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  layoutId?: string;

  @IsOptional()
  @IsBoolean()
  defaultLayout?: boolean;

  @IsOptional()
  @IsBoolean()
  master?: boolean;

  @IsOptional()
  @IsBoolean()
  masterBackground?: boolean;

  @IsOptional()
  @IsIn(LAYOUT_KINDS)
  layoutKind?: LayoutKind;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  designId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  layoutSetId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => SlideThemeDto)
  theme?: SlideTheme;
}
