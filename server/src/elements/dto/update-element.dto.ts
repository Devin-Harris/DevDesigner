import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  ARROWHEAD_TYPES,
  CODE_LANGUAGES,
  CODE_DIFF_VIEWS,
  FILL_STYLES,
  STROKE_STYLES,
  TEXT_ALIGNS,
  VERTICAL_ALIGNS,
  type ArrowheadType,
  type CodeLanguage,
  type CodeDiffView,
  type ElementBinding,
  type FillStyle,
  type PointModel,
  type SlideConfig,
  type PlaceholderConfig,
  type MediaConfig,
  type TextRun,
  type StrokeStyle,
  type TextAlign,
  type VerticalAlign,
  type UpdateElementDto as IUpdateElementDto,
} from '@dbdesigner/shared';
import { PointDto } from './point.dto';
import { BindingDto } from './binding.dto';
import { MediaDto, PlaceholderDto, SlideDto } from './slide.dto';
import { TextRunDto } from './text-run.dto';

/** Body for PATCH /elements/:elementId (style / content / geometry). */
export class UpdateElementDto implements IUpdateElementDto {
  @IsOptional()
  @IsNumber()
  x?: number;

  @IsOptional()
  @IsNumber()
  y?: number;

  @IsOptional()
  @IsNumber()
  width?: number;

  @IsOptional()
  @IsNumber()
  height?: number;

  @IsOptional()
  @IsNumber()
  angle?: number;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  strokeColor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  backgroundColor?: string;

  @IsOptional()
  @IsIn([...FILL_STYLES])
  fillStyle?: FillStyle;

  @IsOptional()
  @IsNumber()
  strokeWidth?: number;

  @IsOptional()
  @IsIn([...STROKE_STYLES])
  strokeStyle?: StrokeStyle;

  @IsOptional()
  @IsNumber()
  opacity?: number;

  @IsOptional()
  @IsNumber()
  zIndex?: number;

  @IsOptional()
  @IsNumber()
  cornerRadius?: number;

  @IsOptional()
  @IsBoolean()
  ellipticCorners?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PointDto)
  points?: PointModel[];

  @IsOptional()
  @IsString()
  @MaxLength(50000)
  text?: string;

  @IsOptional()
  @IsNumber()
  fontSize?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  fontFamily?: string;

  @IsOptional()
  @IsBoolean()
  bold?: boolean;

  @IsOptional()
  @IsBoolean()
  aboveTables?: boolean;

  @IsOptional()
  @IsBoolean()
  italic?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0.8)
  @Max(4)
  lineHeight?: number;

  @IsOptional()
  @IsBoolean()
  wrap?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => TextRunDto)
  runs?: TextRun[] | null;

  @IsOptional()
  @IsIn([...TEXT_ALIGNS])
  textAlign?: TextAlign;

  @IsOptional()
  @IsIn([...VERTICAL_ALIGNS])
  verticalAlign?: VerticalAlign;

  @IsOptional()
  @ValidateNested()
  @Type(() => BindingDto)
  startBinding?: ElementBinding | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => BindingDto)
  endBinding?: ElementBinding | null;

  @IsOptional()
  @IsIn([...ARROWHEAD_TYPES])
  startArrowhead?: ArrowheadType;

  @IsOptional()
  @IsIn([...ARROWHEAD_TYPES])
  endArrowhead?: ArrowheadType;

  @IsOptional()
  @IsNumber()
  curvature?: number;

  @IsOptional()
  @IsIn([...CODE_LANGUAGES])
  language?: CodeLanguage;

  /** Code only: the changed side of a diff; null clears it. */
  @IsOptional()
  @IsString()
  @MaxLength(50000)
  diffText?: string | null;

  @IsOptional()
  @IsIn([...CODE_DIFF_VIEWS])
  diffView?: CodeDiffView;

  /** Code only: left side's share of the width in split views. */
  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(0.9)
  diffSplit?: number;

  /** Code only: count whitespace-only changes in the diff. */
  @IsOptional()
  @IsBoolean()
  diffShowWhitespace?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  fileName?: string;

  /** Set = collapsed (height to restore); null = expanded. */
  @IsOptional()
  @IsNumber()
  expandedHeight?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  groupId?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => SlideDto)
  slide?: SlideConfig | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => PlaceholderDto)
  placeholder?: PlaceholderConfig | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => MediaDto)
  media?: MediaConfig | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  overrides?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  morphId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  step?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  slideId?: string | null;
}
