import { IsIn, IsISO8601, IsOptional } from 'class-validator';
import type { CreateShareLinkDto as ICreateShareLinkDto, ShareAccessLevel } from '@dbdesigner/shared';

/** Body for POST /projects/:projectId/share. Owner picks the link's level. */
export class CreateShareLinkDto implements ICreateShareLinkDto {
  // A link never grants OWNER, only EDIT or VIEW (BUILD_INSTRUCTIONS.md section 6).
  @IsIn(['EDIT', 'VIEW'])
  accessLevel!: ShareAccessLevel;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}
