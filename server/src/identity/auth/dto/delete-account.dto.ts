import { IsOptional, IsString, MaxLength } from 'class-validator';

/** DELETE /auth/me body: password accounts confirm with their password. */
export class DeleteAccountDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  password?: string;
}
