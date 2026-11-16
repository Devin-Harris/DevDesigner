import { IsEmail, IsString, MaxLength } from 'class-validator';
import type { LoginDto as LoginDtoShape } from '@devdesigner/shared';

/** Body for POST /auth/login. Implements the shared LoginDto shape. */
export class LoginDto implements LoginDtoShape {
  @IsEmail()
  email!: string;

  @IsString()
  @MaxLength(200)
  password!: string;
}
