import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type {
  AddSyncRemoteDto,
  UpdateSyncRemoteDto,
  ProjectExportFile,
  MergeChoice,
  MergeConflict,
  SchemaModel,
  ProjectSummary,
  SyncDefaultRemoteResponse,
  SyncLinkResponse,
  SyncLinkResult,
  SyncRemoteResponse,
  SyncStatus,
} from '@devdesigner/shared';
import { mergeSchemas } from '@devdesigner/shared';
import { Project } from '../../projects/projects/project.entity';
import { ProjectsService } from '../../projects/projects/projects.service';
import { setRemoteEntityFallback } from '../../collaboration/access/entity-project-resolver';
import { projectRevision } from '../http/project-revision';
import {
  normalizeRemoteUrl,
  RemoteClient,
  RemoteHttpError,
  RemoteUnreachableError,
} from './remote-client';
import { SyncRelay } from './sync-relay';
import { decideReconnect } from './sync-decision';
import { SyncLinkEntity, SyncRemoteEntity } from './sync.entity';
import { TokenCipher } from './token-cipher';

/** Name of the built-in hosted remote in the Sync panel. */
export const DEFAULT_REMOTE_NAME = 'DevDesigner Cloud';

/** How often server-backed projects are checked (reconnects, mirror freshness). */
export const SYNC_INTERVAL_MS = 10_000;
/** Quiet time after the last forwarded edit before the local mirror is refreshed. */
const MIRROR_DEBOUNCE_MS = 400;
/** ...but never longer than this during continuous editing (a drag, typing). */
const MIRROR_MAX_WAIT_MS = 2_000;

/**
 * Desktop server-backed projects. A linked project's real copy lives on a remote
 * DevDesigner server; this computer keeps a mirror with the same ids.
 *
 * - live: page requests for the project are forwarded to the server (SyncForwardInterceptor),
 *   the server's other changes arrive over a relay socket and are passed to the editor,
 *   and the mirror is refreshed in the background.
 * - offline: requests are handled locally (edits land in the mirror).
 * - back online: no local edits -> refresh from the server; local edits only -> send
 *   them; both changed -> conflict, until the user picks a version (resolve()).
 */
@Injectable()
export class SyncService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Sync');
  private timer: NodeJS.Timeout | null = null;
  /** Serializes checks, linking and resolving so a project is never synced twice at once. */
  private chain: Promise<unknown> = Promise.resolve();
  /** In-memory view of the links, for the per-request forwarding decision. */
  private readonly linkCache = new Map<string, SyncLinkEntity>();
  private readonly remoteCache = new Map<string, SyncRemoteEntity>();
  private readonly mirrorTimers = new Map<string, NodeJS.Timeout>();
  private readonly mirrorPendingSince = new Map<string, number>();
  private cipher = new TokenCipher('');

  constructor(
    @InjectRepository(SyncRemoteEntity) private readonly remotes: Repository<SyncRemoteEntity>,
    @InjectRepository(SyncLinkEntity) private readonly links: Repository<SyncLinkEntity>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    private readonly projectsService: ProjectsService,
    private readonly relay: SyncRelay,
    private readonly config: ConfigService,
  ) {}

  get enabled(): boolean {
    return this.config.get<string>('DESKTOP') === 'true';
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.enabled) return;
    this.cipher = new TokenCipher(this.config.get<string>('SYNC_TOKEN_KEY', ''));
    await this.encryptStoredTokens();
    await this.reloadCache();
    this.relay.onRemoteChange = (projectId) => this.scheduleMirror(projectId);
    this.relay.onDisconnect = (projectId) => void this.serial(() => this.markOffline(projectId));
    // An item id this computer has not mirrored yet (just created on the server) belongs
    // to the server-backed project that is open here; the server checks access itself.
    setRemoteEntityFallback(() => this.singleLiveProject());
    this.timer = setInterval(() => void this.serial(() => this.checkAll()), SYNC_INTERVAL_MS);
    this.timer.unref();
    void this.serial(() => this.checkAll());
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    for (const t of this.mirrorTimers.values()) clearTimeout(t);
    this.relay.closeAll();
    setRemoteEntityFallback(null);
  }

  // --- Forwarding (used by SyncForwardInterceptor) ---

  /** The remote to send this project's requests to, when it is live. */
  forwardTarget(projectId: string): { client: RemoteClient; clientId: string | null } | null {
    const link = this.linkCache.get(projectId);
    if (!link || link.status !== 'live') return null;
    const remote = this.remoteCache.get(link.remoteId);
    if (!remote) return null;
    return { client: this.client(remote), clientId: this.relay.clientIdOf(projectId) };
  }

  /** A forwarded edit succeeded: refresh the mirror once edits pause. */
  afterForwardedWrite(projectId: string): void {
    this.scheduleMirror(projectId);
  }

  /** A forward found the server unreachable: switch to local editing now. */
  forwardFailed(projectId: string): Promise<void> {
    return this.serial(() => this.markOffline(projectId));
  }

  // --- Remotes ---

  /** The hosted server this build offers as a ready-made remote (SYNC_DEFAULT_REMOTE_URL). */
  async defaultRemote(ownerId: string): Promise<SyncDefaultRemoteResponse | null> {
    const raw = this.config.get<string>('SYNC_DEFAULT_REMOTE_URL', '');
    if (!raw) return null;
    let url: string;
    try {
      url = normalizeRemoteUrl(raw);
    } catch {
      this.log.warn(`Ignoring invalid SYNC_DEFAULT_REMOTE_URL "${raw}"`);
      return null;
    }
    const connected = await this.remotes.exists({ where: { ownerId, url } });
    return { name: DEFAULT_REMOTE_NAME, url, connected };
  }

  async listRemotes(ownerId: string): Promise<SyncRemoteResponse[]> {
    return (await this.remotes.find({ where: { ownerId }, order: { createdAt: 'ASC' } })).map(
      toRemoteResponse,
    );
  }

  async addRemote(ownerId: string, dto: AddSyncRemoteDto): Promise<SyncRemoteResponse> {
    let url: string;
    try {
      url = normalizeRemoteUrl(dto.url);
    } catch {
      throw new BadRequestException(
        'Enter the remote server URL, like https://devdesigner.example.com.',
      );
    }
    const token = dto.token.trim();
    const me = await this.call(() => new RemoteClient(url, token).me(), 'Could not add the server');
    if (!me) throw new BadRequestException('That server did not accept the API token.');
    const saved = await this.remotes.save(
      this.remotes.create({
        ownerId,
        name: dto.name.trim() || new URL(url).host,
        url,
        token: this.cipher.encrypt(token),
        account: me.displayName?.trim() || me.email || null,
      }),
    );
    this.remoteCache.set(saved.id, saved);
    return toRemoteResponse(saved);
  }

  /**
   * Rename a server, or point it at a new URL / token. A new URL or token is checked
   * (the server must accept the token) before anything is saved; its synced projects
   * then reconnect with the new details.
   */
  async updateRemote(
    ownerId: string,
    remoteId: string,
    dto: UpdateSyncRemoteDto,
  ): Promise<SyncRemoteResponse> {
    const remote = await this.ownRemote(ownerId, remoteId);
    let url = remote.url;
    if (dto.url !== undefined && dto.url.trim()) {
      try {
        url = normalizeRemoteUrl(dto.url);
      } catch {
        throw new BadRequestException(
          'Enter the remote server URL, like https://devdesigner.example.com.',
        );
      }
    }
    const newToken = dto.token?.trim() || null;
    const connectionChanged = url !== remote.url || newToken !== null;
    if (connectionChanged) {
      const token = newToken ?? this.tokenOf(remote);
      const me = await this.call(
        () => new RemoteClient(url, token).me(),
        'Could not reach the server',
      );
      if (!me) throw new BadRequestException('That server did not accept the API token.');
      remote.url = url;
      if (newToken) remote.token = this.cipher.encrypt(newToken);
      remote.account = me.displayName?.trim() || me.email || null;
    }
    if (dto.name !== undefined) remote.name = dto.name.trim() || new URL(remote.url).host;
    const saved = await this.remotes.save(remote);
    this.remoteCache.set(saved.id, saved);
    if (connectionChanged) {
      const links = await this.links.find({ where: { remoteId } });
      for (const link of links) this.relay.close(link.projectId);
      void this.serial(() => this.checkLinks(links.filter((l) => l.autoSync)));
    }
    return toRemoteResponse(saved);
  }

  /** Remove a server. Its synced projects stay on this computer as ordinary local projects. */
  async removeRemote(ownerId: string, remoteId: string): Promise<void> {
    const gone = await this.links.find({ where: { remoteId } });
    const result = await this.remotes.delete({ id: remoteId, ownerId });
    if (!result.affected) throw new NotFoundException('Remote not found.');
    this.remoteCache.delete(remoteId);
    for (const link of gone) this.forget(link.projectId);
  }

  async remoteProjects(ownerId: string, remoteId: string): Promise<ProjectSummary[]> {
    const remote = await this.ownRemote(ownerId, remoteId);
    return this.call(
      () => this.client(remote).listProjects(),
      'Could not list the remote projects',
    );
  }

  // --- Links ---

  async listLinks(ownerId: string): Promise<SyncLinkResponse[]> {
    const rows = await this.links
      .createQueryBuilder('l')
      .innerJoin(SyncRemoteEntity, 'r', 'r.id = l.remoteId')
      .where('r.ownerId = :ownerId', { ownerId })
      .getMany();
    return rows.map((l) => toLinkResponse(l));
  }

  /**
   * Upload a local project to a remote. The server becomes its home: the local project
   * is replaced by a mirror under the server's project id (returned).
   */
  async publish(ownerId: string, projectId: string, remoteId: string): Promise<SyncLinkResult> {
    await this.ownProject(ownerId, projectId);
    const remote = await this.ownRemote(ownerId, remoteId);
    if (this.linkCache.has(projectId))
      throw new BadRequestException('This project is already synced.');
    return this.serial(async () => {
      const client = this.client(remote);
      const file = await this.projectsService.exportProject(projectId, 'OWNER');
      const created = await this.call(() => client.importProject(file), 'Upload failed');
      const serverCopy = await this.call(() => client.exportProject(created.id), 'Upload failed');
      const link = await this.createMirror(ownerId, remote, created, serverCopy);
      // The original local project now lives on the server: drop the old copy.
      await this.projectsService.remove(projectId);
      return { link: toLinkResponse(link), projectId: link.projectId };
    });
  }

  /** Download a remote project; it stays the server's (edits go straight to it). */
  async clone(ownerId: string, remoteId: string, remoteProjectId: string): Promise<SyncLinkResult> {
    const remote = await this.ownRemote(ownerId, remoteId);
    return this.serial(async () => {
      const client = this.client(remote);
      const summary = (await this.call(() => client.listProjects(), 'Download failed')).find(
        (p) => p.id === remoteProjectId,
      );
      if (!summary)
        throw new NotFoundException('That project is not on the server (or not yours).');
      const file = await this.call(() => client.exportProject(remoteProjectId), 'Download failed');
      const link = await this.createMirror(ownerId, remote, summary, file);
      return { link: toLinkResponse(link), projectId: link.projectId };
    });
  }

  /** Stop syncing: the local copy becomes an ordinary local project; the server keeps its own. */
  async unlink(ownerId: string, projectId: string): Promise<void> {
    await this.ownProject(ownerId, projectId);
    await this.links.delete({ projectId });
    this.forget(projectId);
  }

  /** "Sync now": check this project immediately. */
  async syncNow(ownerId: string, projectId: string): Promise<SyncLinkResult> {
    await this.ownProject(ownerId, projectId);
    return this.serial(async () => {
      const link = await this.requireLink(projectId);
      await this.checkLinks([link]);
      return { link: toLinkResponse(link), projectId };
    });
  }

  /** The server's current version of a project (for the side-by-side compare). */
  async serverVersion(ownerId: string, projectId: string): Promise<ProjectExportFile> {
    await this.ownProject(ownerId, projectId);
    const link = await this.requireLink(projectId);
    const remote = await this.remotes.findOneOrFail({ where: { id: link.remoteId } });
    return this.call(
      () => this.client(remote).exportProject(projectId),
      'Could not load the server version',
    );
  }

  /** Settle a conflict: keep the server's version, or overwrite the server with this computer's. */
  async resolve(
    ownerId: string,
    projectId: string,
    keep: 'server' | 'mine' | 'merge',
    choices: Record<string, MergeChoice> = {},
  ): Promise<SyncLinkResult> {
    await this.ownProject(ownerId, projectId);
    return this.serial(async () => {
      const link = await this.requireLink(projectId);
      const remote = await this.remotes.findOneOrFail({ where: { id: link.remoteId } });
      const client = this.client(remote);
      const revision = await this.call(
        () => this.remoteRevision(client, projectId),
        'The server is not reachable',
      );
      if (keep === 'merge') {
        const [server, local] = await Promise.all([
          this.call(() => client.exportProject(projectId), 'Could not load the server version'),
          this.projectsService.exportProject(projectId, 'OWNER'),
        ]);
        const base = this.baseOf(link);
        if (!base) throw new BadRequestException('There is no common version to merge from.');
        const merged = mergeSchemas(base, local.schema, server.schema, choices);
        await this.call(
          () => this.pushMerged(link, client, local, server, merged.schema),
          'Could not update the server',
        );
      } else if (keep === 'server') {
        const file = await this.call(
          () => client.exportProject(projectId),
          'Could not load the server version',
        );
        await this.writeMirror(link, file, revision, { silent: false });
      } else {
        const file = await this.projectsService.exportProject(projectId, 'OWNER');
        const pushed = await this.call(
          () => client.mirrorContent(projectId, file),
          'Could not update the server',
        );
        link.mirroredRevision = pushed.revision;
        link.localRevisionAtMirror = projectRevision(projectId);
        link.baseSchema = JSON.stringify(file.schema);
      }
      await this.goLive(link, remote);
      return { link: toLinkResponse(link), projectId };
    });
  }

  // --- Engine ---

  /** One pass over every link, grouped by remote (one project listing per remote). */
  async checkAll(): Promise<void> {
    await this.checkLinks(await this.links.find({ where: { autoSync: true } }));
  }

  private async checkLinks(links: SyncLinkEntity[]): Promise<void> {
    const byRemote = new Map<string, SyncLinkEntity[]>();
    for (const link of links) {
      byRemote.set(link.remoteId, [...(byRemote.get(link.remoteId) ?? []), link]);
    }
    for (const [remoteId, group] of byRemote) {
      const remote = await this.remotes.findOne({ where: { id: remoteId } });
      if (!remote) continue;
      const client = this.client(remote);
      let revisions: Map<string, number>;
      try {
        revisions = new Map((await client.listProjects()).map((p) => [p.id, p.revision ?? 0]));
      } catch (err) {
        for (const link of group) await this.fail(link, err);
        continue;
      }
      for (const link of group) {
        try {
          await this.reconcile(link, remote, client, revisions.get(link.projectId));
        } catch (err) {
          await this.fail(link, err);
        }
      }
    }
  }

  /** The server is reachable: bring this link to `live`, or to `conflict`. */
  private async reconcile(
    link: SyncLinkEntity,
    remote: SyncRemoteEntity,
    client: RemoteClient,
    remoteRevision: number | undefined,
  ): Promise<void> {
    if (remoteRevision === undefined) {
      throw new Error(
        'The project is no longer on the server (deleted there, or the token belongs to another account).',
      );
    }
    const step = decideReconnect({
      status: link.status as SyncStatus,
      localChanged: projectRevision(link.projectId) !== link.localRevisionAtMirror,
      remoteChanged: remoteRevision !== link.mirroredRevision,
    });
    if (step === 'wait') return; // conflict: the user decides
    if (step === 'pull') {
      const file = await client.exportProject(link.projectId);
      // Coming back from offline the editor may be stale: let it swap in the server version.
      await this.writeMirror(link, file, remoteRevision, { silent: link.status === 'live' });
    } else if (step === 'push') {
      const file = await this.projectsService.exportProject(link.projectId, 'OWNER');
      const pushed = await client.mirrorContent(link.projectId, file);
      link.mirroredRevision = pushed.revision;
      link.localRevisionAtMirror = projectRevision(link.projectId);
      link.baseSchema = JSON.stringify(file.schema);
      this.log.log(`sent offline edits of ${link.projectId} to ${remote.name}`);
    } else if (step === 'conflict' && (await this.tryAutoMerge(link, client))) {
      this.log.log(`merged edits of ${link.projectId} with ${remote.name} (no overlapping changes)`);
    } else if (step === 'conflict') {
      link.status = 'conflict';
      link.lastError = null;
      await this.save(link);
      this.relay.close(link.projectId);
      this.log.log(
        `conflict on ${link.projectId}: edited here offline and changed on ${remote.name}`,
      );
      return;
    }
    await this.goLive(link, remote);
  }

  /** In step with the server: live (auto-sync on) or paused (off: no forwarding, no relay). */
  private async goLive(link: SyncLinkEntity, remote: SyncRemoteEntity): Promise<void> {
    link.status = link.autoSync ? 'live' : 'paused';
    link.lastError = null;
    link.lastSyncedAt = new Date();
    await this.save(link);
    if (link.autoSync) this.relay.ensure(link.projectId, remote, this.tokenOf(remote));
    else this.relay.close(link.projectId);
  }

  /** Auto-sync on: catch up with the server now and go live. Off: stop forwarding and relaying. */
  async setAutoSync(ownerId: string, projectId: string, on: boolean): Promise<SyncLinkResult> {
    await this.ownProject(ownerId, projectId);
    return this.serial(async () => {
      const link = await this.requireLink(projectId);
      link.autoSync = on;
      if (!on) {
        if (link.status === 'live' || link.status === 'offline') link.status = 'paused';
        this.relay.close(projectId);
        await this.save(link);
      } else {
        await this.save(link);
        await this.checkLinks([link]);
      }
      return { link: toLinkResponse(link), projectId };
    });
  }

  private async markOffline(projectId: string): Promise<void> {
    const link = await this.links.findOne({ where: { projectId } });
    if (!link || link.status !== 'live') return;
    link.status = 'offline';
    await this.save(link);
    this.relay.close(projectId);
  }

  private async fail(link: SyncLinkEntity, err: unknown): Promise<void> {
    if (err instanceof RemoteUnreachableError) {
      if (link.status !== 'conflict' && link.status !== 'paused') link.status = 'offline';
      link.lastError = null;
    } else {
      link.status = 'error';
      link.lastError = err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500);
    }
    this.relay.close(link.projectId);
    await this.save(link);
  }

  /** Refresh the mirror from the server a moment after its last change. */
  /**
   * Edits made live sit only on the server until this refresh copies them into the
   * mirror. If the connection drops inside that window and the project is then edited
   * offline, reconnecting is a conflict (pushing the mirror would drop them), so the
   * window is kept short.
   */
  private scheduleMirror(projectId: string): void {
    clearTimeout(this.mirrorTimers.get(projectId));
    const first = this.mirrorPendingSince.get(projectId) ?? Date.now();
    this.mirrorPendingSince.set(projectId, first);
    const wait = Math.max(0, Math.min(MIRROR_DEBOUNCE_MS, first + MIRROR_MAX_WAIT_MS - Date.now()));
    this.mirrorTimers.set(
      projectId,
      setTimeout(() => {
        this.mirrorTimers.delete(projectId);
        this.mirrorPendingSince.delete(projectId);
        void this.serial(() => this.refreshMirror(projectId));
      }, wait),
    );
  }

  private async refreshMirror(projectId: string): Promise<void> {
    const link = await this.links.findOne({ where: { projectId } });
    if (!link || link.status !== 'live') return;
    const remote = await this.remotes.findOne({ where: { id: link.remoteId } });
    if (!remote) return;
    const client = this.client(remote);
    try {
      const revision = await this.remoteRevision(client, projectId);
      if (revision === link.mirroredRevision) return;
      const file = await client.exportProject(projectId);
      await this.writeMirror(link, file, revision, { silent: true });
      await this.save(link);
    } catch (err) {
      await this.fail(link, err);
    }
  }

  /** Items changed on both sides, if the project were merged now (for the compare view). */
  async mergePreview(
    ownerId: string,
    projectId: string,
  ): Promise<{ canMerge: boolean; conflicts: MergeConflict[] }> {
    await this.ownProject(ownerId, projectId);
    const link = await this.requireLink(projectId);
    const base = this.baseOf(link);
    if (!base) return { canMerge: false, conflicts: [] };
    const remote = await this.remotes.findOneOrFail({ where: { id: link.remoteId } });
    const [server, local] = await Promise.all([
      this.call(
        () => this.client(remote).exportProject(projectId),
        'Could not load the server version',
      ),
      this.projectsService.exportProject(projectId, 'OWNER'),
    ]);
    return { canMerge: true, conflicts: mergeSchemas(base, local.schema, server.schema).conflicts };
  }

  /**
   * Both sides changed: merge them when no item changed on both. Covers edits that
   * reached the server just before the connection dropped (not yet mirrored here).
   */
  private async tryAutoMerge(link: SyncLinkEntity, client: RemoteClient): Promise<boolean> {
    const base = this.baseOf(link);
    if (!base) return false;
    const [server, local] = await Promise.all([
      client.exportProject(link.projectId),
      this.projectsService.exportProject(link.projectId, 'OWNER'),
    ]);
    const merged = mergeSchemas(base, local.schema, server.schema);
    if (merged.conflicts.length) return false;
    await this.pushMerged(link, client, local, server, merged.schema);
    return true;
  }

  /** Send a merged version to the server, then mirror the server's result here. */
  private async pushMerged(
    link: SyncLinkEntity,
    client: RemoteClient,
    local: ProjectExportFile,
    server: ProjectExportFile,
    schema: SchemaModel,
  ): Promise<void> {
    const images = new Map<string, NonNullable<ProjectExportFile['images']>[number]>();
    for (const img of [...(server.images ?? []), ...(local.images ?? [])]) images.set(img.id, img);
    const file: ProjectExportFile = { ...local, schema, images: [...images.values()] };
    const pushed = await client.mirrorContent(link.projectId, file);
    const after = await client.exportProject(link.projectId);
    await this.writeMirror(link, after, pushed.revision, { silent: false });
  }

  private baseOf(link: SyncLinkEntity): SchemaModel | null {
    if (!link.baseSchema) return null;
    try {
      return JSON.parse(link.baseSchema) as SchemaModel;
    } catch {
      return null;
    }
  }

  /** Make the local project an id-preserving copy of the server's version. */
  private async writeMirror(
    link: SyncLinkEntity,
    file: ProjectExportFile,
    remoteRevision: number,
    opts: { silent: boolean },
  ): Promise<void> {
    await this.projectsService.mirrorProjectContent(link.projectId, file, opts);
    link.mirroredRevision = remoteRevision;
    link.localRevisionAtMirror = projectRevision(link.projectId);
    link.baseSchema = JSON.stringify(file.schema);
  }

  /** A local project under the server's project id, mirroring `file`, linked and live. */
  private async createMirror(
    ownerId: string,
    remote: SyncRemoteEntity,
    summary: ProjectSummary,
    file: ProjectExportFile,
  ): Promise<SyncLinkEntity> {
    if (await this.projects.exists({ where: { id: summary.id } })) {
      throw new ConflictException('This project is already on this computer.');
    }
    await this.projects.save(
      this.projects.create({
        id: summary.id,
        ownerId,
        name: summary.name,
        description: summary.description,
        type: summary.type,
      }),
    );
    const link = this.links.create({
      projectId: summary.id,
      remoteId: remote.id,
      autoSync: true,
      status: 'live',
      lastError: null,
      lastSyncedAt: new Date(),
    });
    try {
      await this.writeMirror(link, file, summary.revision ?? 0, { silent: true });
    } catch (err) {
      await this.projects.delete({ id: summary.id });
      throw err;
    }
    await this.goLive(link, remote);
    return link;
  }

  private async remoteRevision(client: RemoteClient, projectId: string): Promise<number> {
    const summary = (await client.listProjects()).find((p) => p.id === projectId);
    if (!summary) throw new Error('The project is no longer on the server.');
    return summary.revision ?? 0;
  }

  private async save(link: SyncLinkEntity): Promise<void> {
    await this.links.save(link);
    this.linkCache.set(link.projectId, link);
  }

  private forget(projectId: string): void {
    this.linkCache.delete(projectId);
    this.relay.close(projectId);
  }

  private async reloadCache(): Promise<void> {
    this.linkCache.clear();
    this.remoteCache.clear();
    for (const link of await this.links.find()) this.linkCache.set(link.projectId, link);
    for (const remote of await this.remotes.find()) this.remoteCache.set(remote.id, remote);
  }

  /** The one live server-backed project with a relay open here, if exactly one. */
  private singleLiveProject(): string | null {
    const open = [...this.linkCache.values()].filter(
      (l) => l.status === 'live' && this.relay.clientIdOf(l.projectId) !== null,
    );
    return open.length === 1 ? open[0].projectId : null;
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.chain.then(work, work);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private client(remote: SyncRemoteEntity): RemoteClient {
    return new RemoteClient(remote.url, this.tokenOf(remote));
  }

  private tokenOf(remote: SyncRemoteEntity): string {
    return this.cipher.decrypt(remote.token);
  }

  /** Tokens saved before they were encrypted (or before a keychain existed) get encrypted now. */
  private async encryptStoredTokens(): Promise<void> {
    if (!this.cipher.active) return;
    for (const remote of await this.remotes.find()) {
      if (TokenCipher.isEncrypted(remote.token)) continue;
      await this.remotes.update({ id: remote.id }, { token: this.cipher.encrypt(remote.token) });
    }
  }

  /** Run a remote call for a user-facing request: failures become a 400 with a readable reason. */
  private async call<T>(work: () => Promise<T>, what: string): Promise<T> {
    try {
      return await work();
    } catch (err) {
      if (err instanceof RemoteUnreachableError) {
        throw new BadRequestException(`${what}: the server could not be reached.`);
      }
      if (err instanceof RemoteHttpError && err.status === 401) {
        throw new BadRequestException(`${what}: the server rejected the API token.`);
      }
      if (err instanceof ConflictException || err instanceof NotFoundException) throw err;
      throw new BadRequestException(`${what}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async requireLink(projectId: string): Promise<SyncLinkEntity> {
    const link = await this.links.findOne({ where: { projectId } });
    if (!link) throw new NotFoundException('This project is not synced.');
    return link;
  }

  private async ownRemote(ownerId: string, remoteId: string): Promise<SyncRemoteEntity> {
    const remote = await this.remotes.findOne({ where: { id: remoteId, ownerId } });
    if (!remote) throw new NotFoundException('Remote not found.');
    return remote;
  }

  private async ownProject(ownerId: string, projectId: string): Promise<void> {
    if (!(await this.projects.exists({ where: { id: projectId, ownerId } }))) {
      throw new NotFoundException('Project not found.');
    }
  }
}

function toRemoteResponse(r: SyncRemoteEntity): SyncRemoteResponse {
  return {
    id: r.id,
    name: r.name,
    url: r.url,
    account: r.account,
    createdAt: r.createdAt.toISOString(),
  };
}

function toLinkResponse(l: SyncLinkEntity): SyncLinkResponse {
  return {
    projectId: l.projectId,
    remoteId: l.remoteId,
    status: l.status as SyncStatus,
    localChanges: projectRevision(l.projectId) !== l.localRevisionAtMirror,
    autoSync: l.autoSync,
    lastSyncedAt: l.lastSyncedAt ? new Date(l.lastSyncedAt).toISOString() : null,
    lastError: l.lastError,
  };
}
