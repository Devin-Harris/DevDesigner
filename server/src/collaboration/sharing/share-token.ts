import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/*
 * Share tokens at rest (security L-9). share_links.token holds only the SHA-256 of
 * the token, which is what lookups match on: a copy of the database alone no
 * longer opens anyone's diagrams. So that owners can still copy a link they made
 * earlier, the token is also kept sealed (AES-256-GCM) in tokenSealed, under a key
 * derived from SHARE_TOKEN_SECRET (else JWT_SECRET). If that secret changes, old
 * links keep working but their URL can no longer be shown.
 */

const HASH = /^[0-9a-f]{64}$/;
const SEAL_VERSION = 'v1';

/** The stored form of a share token. Tokens are high-entropy, so a fast hash is enough. */
export function hashShareToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * True for a stored value that is already a hash. Plaintext tokens are 32-char
 * nanoids (A-Z a-z 0-9 _ -), so they never look like 64 hex characters.
 */
export function isHashedShareToken(stored: string): boolean {
  return HASH.test(stored);
}

/** Seals and opens share tokens for display to the owner. */
export class ShareTokenSealer {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = createHash('sha256').update(`devdesigner:share-token-seal:${secret}`, 'utf8').digest();
  }

  seal(token: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [SEAL_VERSION, iv.toString('base64url'), tag.toString('base64url'), data.toString('base64url')].join('.');
  }

  /** The token, or null when it was sealed under another secret (or is damaged). */
  open(sealed: string | null | undefined): string | null {
    if (!sealed) return null;
    const [version, iv, tag, data] = sealed.split('.');
    if (version !== SEAL_VERSION || !iv || !tag || data === undefined) return null;
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
      return null;
    }
  }
}
