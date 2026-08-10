import { Module } from '@nestjs/common';

/**
 * Owner authentication (BUILD_INSTRUCTIONS.md sections 5 and 6).
 *
 * Contains: User entity, register/login (email + password, JWT), GET /auth/me,
 * and stubbed OAuth routes (GET /auth/oauth/:provider[/callback]) implemented in
 * Phase 8. Sharing stays anonymous regardless of owner auth.
 */
@Module({})
export class AuthModule {}
