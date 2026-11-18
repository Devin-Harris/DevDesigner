import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  type CanActivate,
  Injectable,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsBoolean, IsIn, IsString, IsUrl, IsUUID, MaxLength, MinLength } from 'class-validator';
import type {
  ProjectSummary,
  ProjectExportFile,
  SyncLinkResult,
  SyncDefaultRemoteResponse,
  SyncLinkResponse,
  SyncRemoteResponse,
} from '@devdesigner/shared';
import { CallerScoped } from '../../collaboration/access/access-policy';
import { Caller } from '../http/caller';
import { SyncService } from './sync.service';

class AddRemoteDto {
  @IsString()
  @MaxLength(80)
  name!: string;

  @IsUrl({ require_tld: false, require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(2000)
  url!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(500)
  token!: string;
}

class PublishDto {
  @IsUUID()
  projectId!: string;

  @IsUUID()
  remoteId!: string;
}

class AutoSyncDto {
  @IsBoolean()
  autoSync!: boolean;
}

class ResolveDto {
  @IsIn(['server', 'mine'])
  keep!: 'server' | 'mine';
}

class CloneDto {
  @IsUUID()
  remoteId!: string;

  @IsString()
  @MaxLength(100)
  remoteProjectId!: string;
}

/** The sync routes exist only on a desktop install. */
@Injectable()
class DesktopOnlyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}
  canActivate(): boolean {
    if (this.config.get<string>('DESKTOP') !== 'true') throw new NotFoundException();
    return true;
  }
}

/** Desktop sync settings and actions for the local user. */
@Controller('sync')
@CallerScoped()
@UseGuards(DesktopOnlyGuard)
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Get('default-remote')
  defaultRemote(@Caller() caller: Caller): Promise<SyncDefaultRemoteResponse | null> {
    return this.sync.defaultRemote(owner(caller));
  }

  @Get('remotes')
  remotes(@Caller() caller: Caller): Promise<SyncRemoteResponse[]> {
    return this.sync.listRemotes(owner(caller));
  }

  @Post('remotes')
  addRemote(@Caller() caller: Caller, @Body() dto: AddRemoteDto): Promise<SyncRemoteResponse> {
    return this.sync.addRemote(owner(caller), dto);
  }

  @Delete('remotes/:remoteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeRemote(@Caller() caller: Caller, @Param('remoteId') remoteId: string): Promise<void> {
    return this.sync.removeRemote(owner(caller), remoteId);
  }

  @Get('remotes/:remoteId/projects')
  remoteProjects(
    @Caller() caller: Caller,
    @Param('remoteId') remoteId: string,
  ): Promise<ProjectSummary[]> {
    return this.sync.remoteProjects(owner(caller), remoteId);
  }

  @Get('links')
  links(@Caller() caller: Caller): Promise<SyncLinkResponse[]> {
    return this.sync.listLinks(owner(caller));
  }

  @Post('links')
  publish(@Caller() caller: Caller, @Body() dto: PublishDto): Promise<SyncLinkResult> {
    return this.sync.publish(owner(caller), dto.projectId, dto.remoteId);
  }

  @Post('clone')
  clone(@Caller() caller: Caller, @Body() dto: CloneDto): Promise<SyncLinkResult> {
    return this.sync.clone(owner(caller), dto.remoteId, dto.remoteProjectId);
  }

  @Post('links/:projectId/sync')
  syncNow(
    @Caller() caller: Caller,
    @Param('projectId') projectId: string,
  ): Promise<SyncLinkResult> {
    return this.sync.syncNow(owner(caller), projectId);
  }

  /** Turn live editing and background syncing on or off for one project. */
  @Patch('links/:projectId')
  setAutoSync(
    @Caller() caller: Caller,
    @Param('projectId') projectId: string,
    @Body() dto: AutoSyncDto,
  ): Promise<SyncLinkResult> {
    return this.sync.setAutoSync(owner(caller), projectId, dto.autoSync);
  }

  /** The server's current version, to compare with this computer's in a conflict. */
  @Get('links/:projectId/server-version')
  serverVersion(
    @Caller() caller: Caller,
    @Param('projectId') projectId: string,
  ): Promise<ProjectExportFile> {
    return this.sync.serverVersion(owner(caller), projectId);
  }

  /** Settle a conflict: keep the server's version or overwrite it with this computer's. */
  @Post('links/:projectId/resolve')
  resolve(
    @Caller() caller: Caller,
    @Param('projectId') projectId: string,
    @Body() dto: ResolveDto,
  ): Promise<SyncLinkResult> {
    return this.sync.resolve(owner(caller), projectId, dto.keep);
  }

  @Delete('links/:projectId')
  @HttpCode(HttpStatus.NO_CONTENT)
  unlink(@Caller() caller: Caller, @Param('projectId') projectId: string): Promise<void> {
    return this.sync.unlink(owner(caller), projectId);
  }
}

function owner(caller: Caller): string {
  if (!caller.userId || caller.viaToken) throw new NotFoundException();
  return caller.userId;
}
