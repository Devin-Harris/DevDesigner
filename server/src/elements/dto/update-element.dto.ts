import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  ARROWHEAD_TYPES,
  FILL_STYLES,
  STROKE_STYLES,
  TEXT_ALIGNS,
  VERTICAL_ALIGNS,
  type ArrowheadType,
  type ElementBinding,
  type FillStyle,
  type PointModel,
  type StrokeStyle,
  type TextAlign,
  type VerticalAlign,
  type UpdateElementDto as IUpdateElementDto,
} from '@dbdesigner/shared';
import { PointDto } from './point.dto';
import { BindingDto } from './binding.dto';

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
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PointDto)
  points?: PointModel[];

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  text?: string;

  @IsOptional()
  @IsNumber()
  fontSize?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  fontFamily?: string;

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
}
