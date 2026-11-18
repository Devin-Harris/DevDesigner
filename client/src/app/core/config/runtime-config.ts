import { environment } from '../../../environments/environment';

/**
 * Values the Electron shell injects before the app boots (preload script, via
 * contextBridge as `window.devdesigner`). The desktop server runs on a random
 * loopback port, so its URLs can't be compiled into environment.ts.
 */
export interface DesktopBridge {
   desktop: true;
   apiBaseUrl: string;
   wsBaseUrl: string;
   /** How an MCP client launches the MCP server bundled with the desktop app. */
   mcp?: { command: string; args: string[]; env: Record<string, string> };
}

function readBridge(): DesktopBridge | null {
   const bridge = (globalThis as { devdesigner?: Partial<DesktopBridge> }).devdesigner;
   return bridge?.desktop === true && typeof bridge.apiBaseUrl === 'string' && typeof bridge.wsBaseUrl === 'string'
      ? (bridge as DesktopBridge)
      : null;
}

const bridge = readBridge();

/**
 * Same-origin builds (self-hosted image: API_URL=same-origin) compile `/api` and ''.
 * Resolve them against the page so every consumer gets an absolute URL.
 */
function absolute(url: string): string {
   const origin = globalThis.location?.origin;
   if (!origin || /^[a-z]+:\/\//i.test(url)) return url;
   return `${origin}${url}`;
}

/**
 * The client's effective configuration: environment.ts, overridden by the desktop
 * bridge when running inside the Electron app. Read config from here, not from
 * environment directly. Desktop never sends telemetry or error reports.
 */
export const runtimeConfig: Omit<typeof environment, 'telemetry'> & {
   desktop: boolean;
   telemetry: boolean;
   desktopMcp: DesktopBridge['mcp'] | null;
} = {
   ...environment,
   desktop: bridge !== null,
   desktopMcp: bridge?.mcp ?? null,
   apiBaseUrl: bridge?.apiBaseUrl ?? absolute(environment.apiBaseUrl),
   wsBaseUrl: bridge?.wsBaseUrl ?? absolute(environment.wsBaseUrl),
   sentryDsn: bridge ? '' : environment.sentryDsn,
   telemetry: bridge ? false : environment.telemetry,
};
