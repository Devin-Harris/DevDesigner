import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { utilityProcess, type UtilityProcess } from 'electron';

/**
 * Runs the NestJS server for the desktop app. Packaged builds fork it as an
 * Electron utility process (native modules are rebuilt for Electron at package
 * time). In dev the workspace's better-sqlite3 is built for system Node, so the
 * server runs under `node` instead.
 */
export class ServerHost {
  private proc: ChildProcess | UtilityProcess | null = null;
  private exited = false;

  constructor(
    private readonly entry: string,
    private readonly env: Record<string, string>,
    private readonly logDir: string,
    private readonly packaged: boolean,
  ) {}

  /**
   * The server package folder (entry is <server>/dist/src/main.js). TypeORM resolves
   * its driver (better-sqlite3) relative to the working directory as a fallback,
   * which is where a workspace install nests it.
   */
  private get cwd(): string {
    // Packaged, the server sits inside app.asar, which is not a real directory: run from
    // resources/ (node_modules resolve from the entry itself there).
    return this.packaged ? process.resourcesPath : join(this.entry, '..', '..', '..');
  }

  get logFile(): string {
    return join(this.logDir, 'server.log');
  }

  start(onExit: (code: number | null) => void): void {
    mkdirSync(this.logDir, { recursive: true });
    const log = createWriteStream(this.logFile, { flags: 'w' });
    const env = { ...process.env, ...this.env };
    const handleExit = (code: number | null): void => {
      this.exited = true;
      log.end();
      onExit(code);
    };
    if (this.packaged) {
      const child = utilityProcess.fork(this.entry, [], {
        env,
        cwd: this.cwd,
        stdio: 'pipe',
        serviceName: 'DevDesigner server',
      });
      child.stdout?.pipe(log, { end: false });
      child.stderr?.pipe(log, { end: false });
      child.on('exit', handleExit);
      this.proc = child;
    } else {
      const child = spawn(process.env.DEVDESIGNER_NODE ?? 'node', [this.entry], {
        env,
        cwd: this.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stdout?.pipe(log, { end: false });
      child.stderr?.pipe(log, { end: false });
      child.on('exit', handleExit);
      child.on('error', () => handleExit(null));
      this.proc = child;
    }
  }

  /** Polls the readiness endpoint until it answers 200 or `timeoutMs` passes. */
  async waitUntilReady(origin: string, timeoutMs = 60_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.exited) throw new Error('The local server stopped while starting.');
      try {
        const res = await fetch(`${origin}/api/health/ready`);
        if (res.ok) return;
      } catch {
        // Not listening yet.
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('The local server did not start in time.');
  }

  stop(): void {
    if (this.proc && !this.exited) this.proc.kill();
    this.proc = null;
  }
}
