/**
 * In-process event telling the realtime gateway that access to a project may have
 * been taken away (security M-2): a share link was revoked, the project was deleted,
 * or its ownership moved. The gateway re-checks the affected sockets and drops the
 * ones that lost access. Not sent to clients.
 */
export const ACCESS_REVOKED_EVENT = 'access.revoked';

export interface AccessRevokedEvent {
  projectId: string;
  /** Only sockets that joined with this share token are affected; absent = everyone. */
  token?: string;
}
