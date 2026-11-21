import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import {
  API_TOKEN_SCOPES,
  type ApiTokenScope,
  type CreateApiTokenDto as CreateApiTokenDtoShape,
} from '@devdesigner/shared';

/** Body for POST /auth/api-tokens. */
export class CreateApiTokenDto implements CreateApiTokenDtoShape {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsIn([...API_TOKEN_SCOPES])
  scope?: ApiTokenScope;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  expiresInDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  projectId?: string;
}
