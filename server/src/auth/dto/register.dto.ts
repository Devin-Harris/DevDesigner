import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { RegisterDto as RegisterDtoShape } from '@devdesigner/shared';

/** Body for POST /auth/register. Implements the shared RegisterDto shape. */
export class RegisterDto implements RegisterDtoShape {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;
}
