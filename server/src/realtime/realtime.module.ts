import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimePublisher } from './realtime.publisher';

/**
 * Realtime collaboration (see the plan Part 2). Hosts the socket.io gateway and
 * the publisher feature services use to broadcast persisted changes.
 *
 * Marked @Global so every feature module can inject RealtimePublisher without
 * re-importing. AccessService comes from the global AccessModule; AuthService is
 * imported from AuthModule to authorize socket handshakes with the same logic as
 * the HTTP layer. Requires EventEmitterModule.forRoot() (registered in AppModule).
 */
@Global()
@Module({
  imports: [AuthModule],
  providers: [RealtimeGateway, RealtimePublisher],
  exports: [RealtimePublisher],
})
export class RealtimeModule {}
