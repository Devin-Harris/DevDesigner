import { Global, Module } from '@nestjs/common';
import { GraphCache } from './graph-cache';
import { ProjectRevisionStore } from './revision-store';

/** Persisted project revisions + the serialized-graph cache (perf P3.4). */
@Global()
@Module({
  providers: [GraphCache, ProjectRevisionStore],
  exports: [GraphCache],
})
export class GraphCacheModule {}
