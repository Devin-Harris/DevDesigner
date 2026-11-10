import type { BatchUpdateAck, BatchUpdateResponse, SchemaMutation } from '@devdesigner/shared';
import { projectRevision } from '../common/project-revision';

/** The id of the row a mutation is about (reorders and project-level changes have none). */
export function mutationEntityId(mutation: SchemaMutation): string | null {
  switch (mutation.kind) {
    case 'table.created':
    case 'table.updated':
      return mutation.table.id;
    case 'table.moved':
    case 'table.deleted':
      return mutation.tableId;
    case 'column.created':
    case 'column.updated':
      return mutation.column.id;
    case 'column.deleted':
      return mutation.columnId;
    case 'index.created':
    case 'index.updated':
      return mutation.index.id;
    case 'index.deleted':
      return mutation.indexId;
    case 'relationship.created':
    case 'relationship.updated':
      return mutation.relationship.id;
    case 'relationship.deleted':
      return mutation.relationshipId;
    case 'element.created':
    case 'element.updated':
      return mutation.element.id;
    case 'element.moved':
    case 'element.deleted':
      return mutation.elementId;
    case 'sequenceDiagram.created':
    case 'sequenceDiagram.updated':
      return mutation.diagram.id;
    case 'sequenceDiagram.deleted':
      return mutation.diagramId;
    case 'lifeline.created':
    case 'lifeline.updated':
      return mutation.lifeline.id;
    case 'lifeline.moved':
    case 'lifeline.deleted':
      return mutation.lifelineId;
    case 'message.created':
    case 'message.updated':
      return mutation.message.id;
    case 'message.moved':
    case 'message.deleted':
      return mutation.messageId;
    default:
      return null;
  }
}

/**
 * Shape a batch / clone result for the caller: the full mutations by default (the MCP
 * reads them), or with `?return=none` just ids and the project's new revision.
 */
export function batchResult(
  projectId: string,
  result: BatchUpdateResponse,
  returnNone: boolean,
): BatchUpdateResponse | BatchUpdateAck {
  if (!returnNone) return result;
  const ids = result.mutations.map(mutationEntityId).filter((id): id is string => id !== null);
  return { ok: true, revision: projectRevision(projectId), ids };
}
