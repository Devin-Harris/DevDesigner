import { Module } from '@nestjs/common';
import { BatchController } from './batch.controller';
import { BatchService } from './batch.service';
import { CloneService } from './clone.service';

/**
 * Batch edits: PATCH /projects/:projectId/batch applies many table / element /
 * sequence / relationship patches and deletes in one transaction. Repositories come
 * from the injected DataSource's transaction manager; access via the global policy layer.
 */
@Module({
  controllers: [BatchController],
  providers: [BatchService, CloneService],
})
export class BatchModule {}
