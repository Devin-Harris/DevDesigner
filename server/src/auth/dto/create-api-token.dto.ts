import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  API_TOKEN_SCOPES,
  type ApiTokenScope,
  type CreateApiTokenDto as CreateApiTokenDtoShape,
} from '@dbdesigner/shared';

/** Body for POST /auth/api-tokens. */
export class CreateApiTokenDto implements CreateApiTokenDtoShape {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsIn([...API_TOKEN_SCOPES])
  scope?: ApiTokenScope;
}
