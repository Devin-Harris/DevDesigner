import type { AccessLevel } from '@devdesigner/shared';
import type { Request } from 'express';
import type { ProjectEntityKind } from './entity-project-resolver';

export type RequiredAccess = 'read' | 'write' | 'owner';

export type AccessPolicy =
  | { kind: 'project'; access: RequiredAccess; from: ProjectEntityKind; param: string }
  | { kind: 'public' }
  | { kind: 'caller' }
  | { kind: 'admin' };

export const ACCESS_POLICY_KEY = 'devdesigner:access-policy';

/** What the guard resolved for this request. */
export interface ResolvedProjectAccess {
  projectId: string;
  accessLevel: AccessLevel;
}

export type RequestWithProjectAccess = Request & { projectAccess?: ResolvedProjectAccess };
