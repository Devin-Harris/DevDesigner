import { Global, Module } from '@nestjs/common';
import { QuotaService } from './quota.service';

/** Storage quotas (security S3.2), available to every feature module. */
@Global()
@Module({
  providers: [QuotaService],
  exports: [QuotaService],
})
export class QuotasModule {}
