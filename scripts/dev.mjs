// Launches the server and client dev servers in two SEPARATE terminal windows,
// so each stream of output (Nest on :3000, Angular on :4200) is isolated.
// Cross-platform: Windows (cmd), macOS (Terminal.app), Linux (common emulators).
//
// Run indirectly via `npm run dev`, which builds the shared package first.

import { spawn } from 'node:child_process';
import process from 'node:process';

const cwd = process.cwd();

/** Each entry becomes its own terminal window. */
const targets = [
  { title: 'DBDesigner Shared (watch)', script: 'watch:shared' },
  { title: 'DBDesigner Server', script: 'dev:server' },
  { title: 'DBDesigner Client', script: 'dev:client' },
];

function openTerminal({ title, script }) {
  const npmCmd = `npm run ${script}`;

  if (process.platform === 'win32') {
    // cmd's `start` builtin opens a new window; /k keeps it open after the process ends.
    // windowsVerbatimArguments stops Node from re-escaping the quotes, so `start`
    // sees the window title and inner command exactly as written.
    const command = `start "${title}" cmd /k "${npmCmd}"`;
    spawn('cmd.exe', ['/c', command], {
      cwd,
      detached: true,
      stdio: 'ignore',
      windowsVerbatimArguments: true,
    });
    return;
  }

  if (process.platform === 'darwin') {
    const osaScript = `tell application "Terminal" to do script "cd '${cwd}' && ${npmCmd}"`;
    spawn('osascript', ['-e', osaScript], { cwd, detached: true, stdio: 'ignore' });
    return;
  }

  // Linux: try a sensible emulator; override with the TERMINAL env var if needed.
  const emulator = process.env.TERMINAL || 'x-terminal-emulator';
  const inner = `cd '${cwd}' && ${npmCmd}; exec bash`;
  spawn(emulator, ['-e', `bash -lc "${inner}"`], { cwd, detached: true, stdio: 'ignore' });
}

for (const target of targets) {
  openTerminal(target);
}

console.log(
  'Opened two terminals: DBDesigner Server (http://localhost:3000) and DBDesigner Client (http://localhost:4200).',
);
