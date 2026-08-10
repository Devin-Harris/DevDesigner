import { Global, Module } from '@nestjs/common';

/**
 * Access-resolution and policy layer (BUILD_INSTRUCTIONS.md sections 6 and 7).
 *
 * Home of:
 *  - the access-resolution guard (resolves OWNER / EDIT / VIEW from a JWT/session
 *    or an X-Share-Token header and attaches it to the request),
 *  - an ancestry-aware authorization helper that, given any entity id, resolves
 *    its owning project and the caller's effective access in one query path,
 *  - reusable policy checks invoked by services before any mutation.
 *
 * Marked @Global so every feature module can inject the policy service without
 * re-importing. Providers are added as Phase 1 lands.
 */
@Global()
@Module({})
export class AccessModule {}
