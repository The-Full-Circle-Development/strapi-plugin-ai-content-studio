import type { Core } from '@strapi/strapi';

/**
 * Shared secret redaction (Constitution I).
 *
 * ONE implementation, used by every path that could echo something key-shaped:
 *   - the chat stream's error path (a provider sometimes puts the key in a request URL),
 *   - the security audit, which masks `evidence` at the TOOL BOUNDARY so a secret never reaches
 *     the model, the persisted transcript, or a log line (FR-049),
 *   - preview tokens, which are bearer credentials for a pending change set and are treated as
 *     key-like here so they can never be logged.
 *
 * Redaction is deliberately over-eager: a false positive costs a masked string in a log line, a
 * false negative costs a leaked credential.
 */

/** Longest run we will ever keep verbatim when masking a value. */
const MASK_TAIL = 4;

interface Rule {
  pattern: RegExp;
  replacement: string;
}

const RULES: Rule[] = [
  // key / token carried in a URL query string (Google puts the key in ?key=…)
  { pattern: /([?&](?:key|api[_-]?key|access_token|token|secret)=)[^&\s"']+/gi, replacement: '$1[redacted]' },
  // the plugin's own preview token, wherever it appears
  { pattern: /([?&]aiStudioPreview=)[^&\s"']+/gi, replacement: '$1[redacted]' },
  { pattern: /(x-ai-studio-preview:\s*)[A-Za-z0-9\-_.=]+/gi, replacement: '$1[redacted]' },
  // provider key shapes
  { pattern: /AIza[0-9A-Za-z\-_]{10,}/g, replacement: '[redacted]' },
  { pattern: /sk-(?:ant-)?[A-Za-z0-9\-_]{6,}/g, replacement: '[redacted]' },
  { pattern: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{16,}/g, replacement: '[redacted]' },
  { pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, replacement: '[redacted]' },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: '[redacted]' },
  // bearer credentials and JWTs
  { pattern: /Bearer\s+[A-Za-z0-9\-_.]+/gi, replacement: 'Bearer [redacted]' },
  { pattern: /\beyJ[A-Za-z0-9\-_]{8,}\.[A-Za-z0-9\-_]{8,}\.[A-Za-z0-9\-_]{8,}\b/g, replacement: '[redacted]' },
  // "apiKey": "…" / api_key=… / password: …
  {
    pattern: /(\b(?:api[_-]?key|apikey|secret|password|passwd|token|auth)\b["']?\s*[:=]\s*["']?)[^\s"',;}]{6,}/gi,
    replacement: '$1[redacted]',
  },
];

/**
 * Heuristic: does this look like a credential rather than ordinary prose?
 * Used by the security audit to decide whether a stored content value is secret-LIKE at all
 * (the finding itself then carries only the mask + location).
 */
const SECRET_LIKE: RegExp[] = [
  /sk-(?:ant-)?[A-Za-z0-9\-_]{6,}/,
  /AIza[0-9A-Za-z\-_]{10,}/,
  /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{16,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\beyJ[A-Za-z0-9\-_]{8,}\.[A-Za-z0-9\-_]{8,}\.[A-Za-z0-9\-_]{8,}\b/,
  /\b(?:api[_-]?key|apikey|secret|password|passwd|access[_-]?token|private[_-]?key)\b["']?\s*[:=]/i,
  /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
  // long, high-entropy, no-whitespace run that is not a URL or a sentence
  /^[A-Za-z0-9+/=_-]{40,}$/,
];

const redactService = ({ strapi: _strapi }: { strapi: Core.Strapi }) => ({
  /** Strip anything key-shaped from a string before it is logged, returned, or sent to a model. */
  redactSecrets(text: string): string {
    if (!text) {
      return text;
    }
    let out = text;
    for (const { pattern, replacement } of RULES) {
      out = out.replace(pattern, replacement);
    }
    return out;
  },

  /** Recursively redact every string inside an arbitrary JSON-ish value. */
  redactDeep(value: unknown, depth = 0): unknown {
    if (depth > 8) {
      return '[omitted]';
    }
    if (typeof value === 'string') {
      return this.redactSecrets(value);
    }
    if (Array.isArray(value)) {
      return value.map((v) => this.redactDeep(v, depth + 1));
    }
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = this.redactDeep(v, depth + 1);
      }
      return out;
    }
    return value;
  },

  /** True when a stored value looks like a credential and should be reported as a finding. */
  looksSecretLike(value: unknown): boolean {
    if (typeof value !== 'string') {
      return false;
    }
    const trimmed = value.trim();
    // Short values and ordinary sentences are not credentials.
    if (trimmed.length < 16 || /\s{2,}/.test(trimmed)) {
      return false;
    }
    return SECRET_LIKE.some((re) => re.test(trimmed));
  },

  /**
   * Mask a value for a finding: a recognizable prefix plus the last 4 characters, never more.
   * e.g. "sk-ant-api03-AbC…xyz4f2a" -> "sk-ant-…••••4f2a"
   */
  mask(value: string): string {
    if (!value) {
      return '';
    }
    const trimmed = value.trim();
    if (trimmed.length <= MASK_TAIL) {
      return '••••';
    }
    const prefixMatch = trimmed.match(/^([A-Za-z]+[-_][A-Za-z0-9]+)/);
    const prefix = prefixMatch ? prefixMatch[1] : trimmed.slice(0, 4);
    return `${prefix}…••••${trimmed.slice(-MASK_TAIL)}`;
  },

  /** Build a concise, key-free description of a provider / stream error. */
  describeError(error: unknown): string {
    const e = error as { name?: string; statusCode?: number; message?: string };
    const parts: string[] = [];
    if (e?.name && e.name !== 'Error') {
      parts.push(String(e.name));
    }
    if (e?.statusCode) {
      parts.push(`HTTP ${e.statusCode}`);
    }
    if (e?.message) {
      parts.push(String(e.message));
    } else if (typeof error === 'string') {
      parts.push(error);
    }
    return this.redactSecrets(parts.join(' — ') || 'unknown error');
  },
});

export default redactService;
