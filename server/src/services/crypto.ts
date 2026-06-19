import crypto from 'node:crypto';
import type { Core } from '@strapi/strapi';

/**
 * AES-256-GCM encryption for provider API keys at rest.
 *
 * The secret comes from the env var `AI_STUDIO_ENC_KEY` (32 bytes, base64) — deliberately
 * NOT APP_KEYS and NOT the existing ENCRYPTION_KEY. Errors NEVER include the key material:
 * messages reference only the variable name and the decoded byte length.
 */

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit nonce, recommended for GCM
const KEY_BYTES = 32; // AES-256
const AUTH_TAG_BYTES = 16;
const ENV_VAR = 'AI_STUDIO_ENC_KEY';

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

const cryptoService = ({ strapi: _strapi }: { strapi: Core.Strapi }) => {
  let cachedKey: Buffer | null = null;
  const key = (): Buffer => {
    if (!cachedKey) {
      cachedKey = loadKey();
    }
    return cachedKey;
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
  };
};

export default cryptoService;
