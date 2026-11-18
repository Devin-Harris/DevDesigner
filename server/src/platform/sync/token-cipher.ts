import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const PREFIX = 'enc:v1:';

/**
 * Encrypts sync API tokens at rest (AES-256-GCM). The key comes from the desktop
 * app, which keeps it in the OS keychain. With no key, tokens stay as they are.
 */
export class TokenCipher {
  private readonly key: Buffer | null;

  constructor(secret: string) {
    this.key = secret ? createHash('sha256').update(secret).digest() : null;
  }

  get active(): boolean {
    return this.key !== null;
  }

  static isEncrypted(stored: string): boolean {
    return stored.startsWith(PREFIX);
  }

  encrypt(token: string): string {
    if (!this.key) return token;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
  }

  /** Plain values (stored before encryption existed) pass through unchanged. */
  decrypt(stored: string): string {
    if (!TokenCipher.isEncrypted(stored)) return stored;
    if (!this.key) throw new Error('This server token is encrypted and the key is missing.');
    const raw = Buffer.from(stored.slice(PREFIX.length), 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  }
}
