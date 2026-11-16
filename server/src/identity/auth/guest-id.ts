/**
 * Anonymous callers identify their browser with a random id kept in
 * localStorage (X-Guest-Id header / socket handshake). Projects created
 * without an account are owned by `guest:<id>`, so one browser's guest
 * projects are invisible to every other browser.
 */
const GUEST_ID = /^[A-Za-z0-9_-]{16,64}$/;

export function guestOwnerId(raw: unknown): string | null {
  return typeof raw === 'string' && GUEST_ID.test(raw) ? `guest:${raw}` : null;
}
