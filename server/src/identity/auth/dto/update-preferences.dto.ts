import { IsBoolean, IsOptional } from 'class-validator';

/** PATCH /auth/me/preferences body: only the keys sent are changed. */
export class UpdatePreferencesDto {
  @IsOptional()
  @IsBoolean()
  gridSnap?: boolean;

  @IsOptional()
  @IsBoolean()
  smartGuides?: boolean;

  @IsOptional()
  @IsBoolean()
  minimap?: boolean;

  @IsOptional()
  @IsBoolean()
  minimapCollapsed?: boolean;
}
