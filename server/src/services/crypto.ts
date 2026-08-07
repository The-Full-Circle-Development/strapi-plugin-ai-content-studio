import crypto from 'node:crypto';
import type { Core } from '@strapi/strapi';
import type { PreviewTokenPayload } from '../types';

/**
 * AES-256-GCM encryption for provider API keys at rest, plus HMAC signing for preview tokens.
 * All crypto stays isolated here (Constitution: "crypto stays isolated in services/crypto.ts").
 *
 * The secret comes from the env var `AI_STUDIO_ENC_KEY` (32 bytes, base64) — deliberately
 * NOT APP_KEYS and NOT the existing ENCRYPTION_KEY. Errors NEVER include the key material:
 * messages reference only the variable name and the decoded byte length.
 *
 * Preview tokens are signed with a LABELLED SUBKEY of that same key (R11), so no second required
 * env var is introduced (FR-054) while the signing key stays cryptographically separate from the
 * key-encryption key. Rotating `AI_STUDIO_ENC_KEY` invalidates outstanding previews — harmless,
 * they last 30 minutes.
 */

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit nonce, recommended for GCM
const KEY_BYTES = 32; // AES-256
const AUTH_TAG_BYTES = 16;
const ENV_VAR = 'AI_STUDIO_ENC_KEY';

/** HKDF-style purpose label. Changing it invalidates every outstanding preview token. */
const PREVIEW_KEY_LABEL = 'ai-content-studio:preview-token:v1';

function loadKey(): Buffer {
  const raw = process.env[ENV_VAR];
  if (!raw || raw.trim() === '') {
    throw new Error(
      `[ai-content-studio] ${ENV_VAR} is not set. Generate one with \`openssl rand -base64 32\` and add it to your environment.`
    );
  }
  let key: Buffer;
  try {
    key = Buffer.from(raw.trim(), 'base64');
  } catch {
    throw new Error(`[ai-content-studio] ${ENV_VAR} is not valid base64.`);
  }
  if (key.length !== KEY_BYTES) {
    // Report only the decoded length — never the key bytes or value.
    throw new Error(
      `[ai-content-studio] ${ENV_VAR} must decode to ${KEY_BYTES} bytes (got ${key.length}). Generate one with \`openssl rand -base64 32\`.`
    );
  }
  return key;
}

/** base64url without padding — safe in a URL query string and in a header value. */
const b64url = (buf: Buffer): string => buf.toString('base64url');

const cryptoService = ({ strapi: _strapi }: { strapi: Core.Strapi }) => {
  let cachedKey: Buffer | null = null;
  const key = (): Buffer => {
    if (!cachedKey) {
      cachedKey = loadKey();
    }
    return cachedKey;
  };

  let cachedPreviewKey: Buffer | null = null;
  /**
   * Labelled subkey derivation. HKDF-Expand with a fixed purpose label: the preview signing key
   * cannot be used to decrypt provider keys and vice versa, while both inherit the boot-time
   * validation of the one env var.
   */
  const previewKey = (): Buffer => {
    if (!cachedPreviewKey) {
      cachedPreviewKey = Buffer.from(
        crypto.hkdfSync('sha256', key(), Buffer.alloc(0), Buffer.from(PREVIEW_KEY_LABEL, 'utf8'), KEY_BYTES)
      );
    }
    return cachedPreviewKey;
  };

  return {
    /** Validates the env key. Throws (with no secret material) if missing/wrong length. */
    assertConfigured(): void {
      key();
    },

    /** Returns "iv:authTag:ciphertext", each segment base64. */
    encrypt(plaintext: string): string {
      const iv = crypto.randomBytes(IV_BYTES);
      const cipher = crypto.createCipheriv(ALGO, key(), iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const authTag = cipher.getAuthTag();
      return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':');
    },

    /** Inverse of encrypt. Throws if the payload is malformed or the auth tag fails to verify. */
    decrypt(payload: string): string {
      const parts = payload.split(':');
      if (parts.length !== 3) {
        throw new Error('[ai-content-studio] Malformed encrypted payload.');
      }
      const [ivB64, tagB64, dataB64] = parts;
      const iv = Buffer.from(ivB64, 'base64');
      const authTag = Buffer.from(tagB64, 'base64');
      const ciphertext = Buffer.from(dataB64, 'base64');
      if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
        throw new Error('[ai-content-studio] Encrypted payload has invalid IV/tag length.');
      }
      const decipher = crypto.createDecipheriv(ALGO, key(), iv);
      decipher.setAuthTag(authTag);
      // GCM final() throws if the auth tag does not verify — tamper / wrong-key detection.
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    },

    /**
     * Masks a key for display: keeps a recognizable prefix and the last 4 chars.
     * e.g. "sk-ant-api03-AbC...xyz4f2a" -> "sk-ant-...••••4f2a"
     */
    maskKey(plaintext: string): string {
      if (!plaintext) {
        return '';
      }
      const last4 = plaintext.slice(-4);
      const match = plaintext.match(/^([a-zA-Z]+-[a-zA-Z0-9]+)/);
      const prefix = match ? match[1] : plaintext.slice(0, 6);
      return `${prefix}-...••••${last4}`;
    },

    /* ------------------------------------------------------------ preview tokens (R11) */

    /**
     * Sign a preview token: `<base64url(payload)>.<base64url(HMAC-SHA256)>`.
     * Opaque, single-purpose, and carries no ability to write.
     */
    signPreviewToken(payload: PreviewTokenPayload): string {
      const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
      const sig = b64url(crypto.createHmac('sha256', previewKey()).update(body).digest());
      return `${body}.${sig}`;
    },

    /**
     * Verify signature AND expiry. Returns null for anything that does not verify — the caller
     * IGNORES an invalid token rather than erroring, so a stale link degrades to the live site
     * instead of breaking the page, and the token cannot be used to probe.
     *
     * Verification is pure crypto: it happens BEFORE any database access.
     */
    verifyPreviewToken(token: string | null | undefined): PreviewTokenPayload | null {
      if (!token || typeof token !== 'string') {
        return null;
      }
      const dot = token.indexOf('.');
      if (dot <= 0 || dot === token.length - 1) {
        return null;
      }
      const body = token.slice(0, dot);
      const sig = token.slice(dot + 1);

      let expected: Buffer;
      let provided: Buffer;
      try {
        expected = crypto.createHmac('sha256', previewKey()).update(body).digest();
        provided = Buffer.from(sig, 'base64url');
      } catch {
        return null;
      }
      // Constant-time compare; timingSafeEqual throws on a length mismatch, so guard first.
      if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
        return null;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      } catch {
        return null;
      }
      const p = parsed as Partial<PreviewTokenPayload> | null;
      if (
        !p ||
        typeof p.sessionId !== 'string' ||
        typeof p.ownerId !== 'number' ||
        typeof p.changeSetId !== 'string' ||
        typeof p.exp !== 'number'
      ) {
        return null;
      }
      if (p.exp * 1000 <= Date.now()) {
        return null;
      }
      return p as PreviewTokenPayload;
    },
  };
};

export default cryptoService;
