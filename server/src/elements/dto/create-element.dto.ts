import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsUUID,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  ARROWHEAD_TYPES,
  CODE_LANGUAGES,
  ELEMENT_TYPES,
  FILL_STYLES,
  STROKE_STYLES,
  TEXT_ALIGNS,
  VERTICAL_ALIGNS,
  type ArrowheadType,
  type CodeLanguage,
  type CreateElementDto as ICreateElementDto,
  type ElementBinding,
  type ElementType,
  type FillStyle,
  type PointModel,
  type SlideConfig,
  type PlaceholderConfig,
  type TextRun,
  type StrokeStyle,
  type TextAlign,
  type VerticalAlign,
} from '@dbdesigner/shared';
import { PointDto } from './point.dto';
import { BindingDto } from './binding.dto';
import { PlaceholderDto, SlideDto } from './slide.dto';
import { TextRunDto } from './text-run.dto';

/** Body for POST /projects/:projectId/elements. */
export class CreateElementDto implements ICreateElementDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsIn([...ELEMENT_TYPES])
  type!: ElementType;

  @IsNumber()
  x!: number;

  @IsNumber()
  y!: number;

  @IsNumber()
  width!: number;

  @IsNumber()
  height!: number;

  @IsOptional()
  @IsNumber()
  angle?: number;

  @IsString()
  @MaxLength(32)
  strokeColor!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  backgroundColor?: string;

  @IsIn([...FILL_STYLES])
  fillStyle!: FillStyle;

  @IsNumber()
  strokeWidth!: number;

  @IsIn([...STROKE_STYLES])
  strokeStyle!: StrokeStyle;

  @IsNumber()
  opacity!: number;

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
  runs?: TextRun[];

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
  @IsString()
  @MaxLength(100)
  fileId?: string;

  @IsOptional()
  @IsIn([...CODE_LANGUAGES])
  language?: CodeLanguage;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  fileName?: string;

  @IsOptional()
  @IsNumber()
  expandedHeight?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => SlideDto)
  slide?: SlideConfig;

  @IsOptional()
  @ValidateNested()
  @Type(() => PlaceholderDto)
  placeholder?: PlaceholderConfig;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  overrides?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  morphId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  step?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  slideId?: string;
}
