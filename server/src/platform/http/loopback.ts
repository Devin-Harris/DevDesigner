const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** The raw socket peer (not X-Forwarded-For) is a loopback address. */
export function isLoopback(address: string | undefined): boolean {
  return !!address && LOOPBACK.has(address);
}
