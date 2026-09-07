import { z } from 'zod';
import type { Core } from '@strapi/strapi';
import { PROVIDER_IDS } from './providers';

/**
 * Plugin configuration persisted in the Strapi plugin store.
 *
 * Raw settings (including encrypted keys) NEVER leave the server. The only client-facing
 * shape is produced by `getMaskedConfig()`.
 *
 * The `providers` map is EXTENSIBLE (data-model §3): an unknown key is carried through untouched on
 * read and on write, so downgrading and re-upgrading does not silently discard a configuration.
 * Only ids in the provider table are ever offered for selection.
 */

/**
 * A saved provider id. Deliberately `string` rather than a literal union: the table in
 * `providers.ts` is the allow-list (FR-002), and widening this is what lets an install hold a
 * configuration for a provider this build does not offer without losing it.
 */
export type ProviderId = string;

export interface ProviderState {
  /** AES-256-GCM payload "iv:authTag:ciphertext" (base64), or null when unset. */
  apiKeyEnc: string | null;
  /** Derived on read from `apiKeyEnc != null` — never persisted as truth. */
  isSet: boolean;
  enabled: boolean;
  /**
   * Its OWN field, never merged into or rendered beside the credential (FR-008). That separation
   * is the point: a base URL can be shown, checked and corrected without ever risking the key.
   */
  baseUrl: string | null;
}

export interface StudioSettings {
  activeProvider: ProviderId;
  activeModel: string;
  providers: Record<string, ProviderState>;
  /** The RUNTIME grounding switch. Narrowed by, and never able to override, the plugin-config
   *  hard off-switch — see `isGroundingEnabled()`. */
  grounding: { enabled: boolean };
}

export interface MaskedProviderState {
  isSet: boolean;
  enabled: boolean;
  masked: string | null;
  /** Returned IN FULL: it is configuration, not a secret (FR-008). */
  baseUrl: string | null;
}

export interface MaskedStudioConfig {
  activeProvider: ProviderId;
  activeModel: string;
  providers: Record<string, MaskedProviderState>;
  grounding: { enabled: boolean };
}

/* --------------------------------------------------- static plugin options (config/index.ts) */

export interface PreviewOptions {
  enabled: boolean;
  baseUrl: string | null;
  paths: Record<string, string>;
  ttlMinutes: number;
}

export interface AttachmentOptions {
  totalBudgetMb: number;
  totalBudgetBytes: number;
}

export interface GroundingOptions {
  /** The HARD off-switch, set by the host application's developer at deploy time. No runtime
   *  toggle can re-enable it (contracts/install-description.md §7). */
  enabled: boolean;
  /** Declared character budget, clamped 2,000..80,000. */
  maxChars: number;
}

/** Seeded from the provider table so there is no second copy of the shipped id list. */
export const PROVIDERS: ProviderId[] = [...PROVIDER_IDS];

const STORE_PARAMS = { type: 'plugin', name: 'ai-content-studio', key: 'settings' } as const;

/* --------------------------------------------------------------- base URL validation */

/**
 * An administrator-supplied endpoint (FR-008).
 *
 * `z.url({ protocol: /^https?$/ })` is deliberate and `z.httpUrl()` is deliberately NOT used.
 * `z.httpUrl()` pins zod's `domain` regex, which was verified against the installed zod 4.4.3 to
 * REJECT `http://localhost:11434/v1`, `http://127.0.0.1:8080/v1` and `http://ollama:11434/v1` —
 * precisely the self-hosted `openai-compatible` endpoints this feature exists to serve. The
 * protocol form accepts those and still rejects `/v1`, `ftp://x.com` and `http:example.com`.
 *
 * Two rules stay ours, because `z.url()` does not cover them:
 *  - userinfo is REFUSED. `z.url()` accepts `https://user:pw@host`, and a credential smuggled into
 *    the endpoint field would sit outside the encrypted-key path entirely (Principle I).
 *  - trailing slashes are trimmed, reusing the idiom `getPreviewOptions()` already uses below, so
 *    one endpoint written two ways normalizes to one stored value.
 */
export const baseUrlSchema = z
  .url({ protocol: /^https?$/ })
  .refine((value) => !/^[a-z]+:\/\/[^/@]*@/i.test(value), {
    message: 'Base URL must not contain a username or password.',
  })
  .transform((value) => value.trim().replace(/\/+$/, ''));

/**
 * Parse one base-URL input into a stored value.
 *
 * `null` and `''` both CLEAR the field; anything else must validate. Returns a discriminated
 * result rather than throwing, so the controller can answer a `400` naming the field.
 */
export const parseBaseUrl = (
  input: unknown
): { ok: true; value: string | null } | { ok: false; message: string } => {
  if (input === null || input === undefined || (typeof input === 'string' && input.trim() === '')) {
    return { ok: true, value: null };
  }
  if (typeof input !== 'string') {
    return { ok: false, message: 'Base URL must be a string.' };
  }
  const parsed = baseUrlSchema.safeParse(input.trim());
  if (!parsed.success) {
    return {
      ok: false,
      message:
        parsed.error.issues[0]?.message ??
        'Base URL must be an absolute http:// or https:// URL with no username or password.',
    };
  }
  return { ok: true, value: parsed.data };
};

/* ------------------------------------------------------------------- normalization */

const emptyProvider = (): ProviderState => ({
  apiKeyEnc: null,
  isSet: false,
  enabled: false,
  baseUrl: null,
});

const defaults = (): StudioSettings => ({
  activeProvider: PROVIDERS[0],
  activeModel: '',
  providers: Object.fromEntries(PROVIDERS.map((id) => [id, emptyProvider()])),
  grounding: { enabled: true },
});

/**
 * Fill defaults for any missing field, derive `isSet` from the stored ciphertext, and PRESERVE
 * unknown provider keys.
 *
 * Pure and exported so `config.test.ts` can assert it without a Strapi runtime. Every rule here is
 * an upgrade-safety rule: a missing field always takes its default, so an install written by an
 * older build never breaks on read (FR-036).
 */
export const normalizeSettings = (
  raw: Partial<StudioSettings> | null | undefined
): StudioSettings => {
  const base = defaults();
  if (!raw) {
    return base;
  }

  // Union of the shipped ids and whatever is actually stored, so a configuration for a provider
  // this build does not offer survives a read/write round trip.
  const keys = Array.from(new Set([...PROVIDERS, ...Object.keys(raw.providers ?? {})]));
  const providers: Record<string, ProviderState> = {};
  for (const id of keys) {
    const stored = raw.providers?.[id];
    if (!stored) {
      providers[id] = emptyProvider();
      continue;
    }
    const apiKeyEnc = stored.apiKeyEnc ?? null;
    providers[id] = {
      apiKeyEnc,
      // ALWAYS recomputed from the ciphertext, never trusted from input.
      isSet: apiKeyEnc != null,
      enabled: stored.enabled ?? false,
      baseUrl: typeof stored.baseUrl === 'string' && stored.baseUrl !== '' ? stored.baseUrl : null,
    };
  }

  return {
    activeProvider: raw.activeProvider ?? base.activeProvider,
    activeModel: raw.activeModel ?? base.activeModel,
    providers,
    // A missing `grounding` defaults to ON, so an existing install gains it on upgrade (FR-036).
    grounding: { enabled: raw.grounding?.enabled !== false },
  };
};

/**
 * The two-switch precedence rule of contracts/install-description.md §7, computed in exactly ONE
 * place.
 *
 * Two flags with the rule re-derived at each call site is how they end up disagreeing, so every
 * caller — the prompt composer, the chat controller, the inspector — reads this.
 */
export const isGroundingEnabledFrom = (pluginEnabled: boolean, settingsEnabled: boolean): boolean =>
  pluginEnabled && settingsEnabled;

/** Clamp a config number into a sane range, falling back to the default for junk input. */
const num = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(n)));
};

const configService = ({ strapi }: { strapi: Core.Strapi }) => {
  const store = () => strapi.store(STORE_PARAMS);
  const cryptoSvc = () => strapi.plugin('ai-content-studio').service('crypto');
  const option = <T>(key: string, fallback: T): T =>
    strapi.config.get(`plugin::ai-content-studio.${key}`, fallback) as T;

  const service = {
    /** Raw settings including encrypted keys. SERVER-INTERNAL ONLY — never send to the client. */
    async get(): Promise<StudioSettings> {
      const raw = (await store().get({})) as Partial<StudioSettings> | null;
      return normalizeSettings(raw);
    },

    async set(next: StudioSettings): Promise<void> {
      await store().set({ value: next });
    },

    /** Encrypts and persists a provider's key. Pass null to clear it. */
    async setProviderKey(provider: ProviderId, plaintextKey: string | null): Promise<void> {
      const current = await service.get();
      const apiKeyEnc = plaintextKey ? cryptoSvc().encrypt(plaintextKey) : null;
      current.providers[provider] = {
        ...(current.providers[provider] ?? emptyProvider()),
        apiKeyEnc,
        isSet: apiKeyEnc != null,
      };
      await service.set(current);
    },

    async setProviderEnabled(provider: ProviderId, enabled: boolean): Promise<void> {
      const current = await service.get();
      current.providers[provider] = {
        ...(current.providers[provider] ?? emptyProvider()),
        enabled,
      };
      await service.set(current);
    },

    /** Persists an already-validated base URL. Pass null to clear it. */
    async setProviderBaseUrl(provider: ProviderId, baseUrl: string | null): Promise<void> {
      const current = await service.get();
      current.providers[provider] = {
        ...(current.providers[provider] ?? emptyProvider()),
        baseUrl,
      };
      await service.set(current);
    },

    async setActive(activeProvider: ProviderId, activeModel: string): Promise<void> {
      const current = await service.get();
      current.activeProvider = activeProvider;
      // Stored VERBATIM — never validated against a curated list, normalized, lowercased or
      // date-suffixed (FR-004, FR-005).
      current.activeModel = activeModel;
      await service.set(current);
    },

    async setGroundingEnabled(enabled: boolean): Promise<void> {
      const current = await service.get();
      current.grounding = { enabled };
      await service.set(current);
    },

    /** Decrypts and returns a provider's raw key, or null. SERVER-INTERNAL ONLY. */
    async getDecryptedKey(provider: ProviderId): Promise<string | null> {
      const current = await service.get();
      // Only the REQUESTED provider's ciphertext is touched (data-model §3).
      const enc = current.providers[provider]?.apiKeyEnc;
      if (!enc) {
        return null;
      }
      return cryptoSvc().decrypt(enc);
    },

    /** Safe-for-client view. NEVER includes raw or encrypted keys — masked + flags only. */
    async getMaskedConfig(): Promise<MaskedStudioConfig> {
      const current = await service.get();
      const providers: Record<string, MaskedProviderState> = {};
      for (const [id, st] of Object.entries(current.providers)) {
        let masked: string | null = null;
        if (st.apiKeyEnc) {
          // Decrypt transiently only to mask — the plaintext never leaves this function.
          masked = cryptoSvc().maskKey(cryptoSvc().decrypt(st.apiKeyEnc));
        }
        providers[id] = {
          isSet: st.isSet,
          enabled: st.enabled,
          masked,
          baseUrl: st.baseUrl,
        };
      }
      return {
        activeProvider: current.activeProvider,
        activeModel: current.activeModel,
        providers,
        grounding: current.grounding,
      };
    },

    /**
     * The EFFECTIVE grounding switch — the AND of the deploy-time hard off-switch and the runtime
     * toggle (contracts/install-description.md §7). Every caller reads this, never one flag.
     */
    async isGroundingEnabled(): Promise<boolean> {
      const settings = await service.get();
      return isGroundingEnabledFrom(
        service.getGroundingOptions().enabled,
        settings.grounding.enabled
      );
    },

    /**
     * Which switch is holding grounding off, for the inspector's English hint (FR-035). `null`
     * when it is on. `'config'` wins, because it is the one a runtime toggle cannot lift.
     */
    async groundingDisabledBy(): Promise<'config' | 'settings' | null> {
      if (!service.getGroundingOptions().enabled) {
        return 'config';
      }
      const settings = await service.get();
      return settings.grounding.enabled ? null : 'settings';
    },

    /* ------------------------------------------------- static options, typed and defaulted */

    /**
     * Preview options. `enabled` is false unless a project opts in, and an enabled preview with
     * no `baseUrl` is treated as NOT configured, so the panel falls back to the field comparison
     * instead of producing a broken URL (FR-014).
     */
    getPreviewOptions(): PreviewOptions {
      const raw = option<Record<string, unknown>>('preview', {});
      const baseUrl = typeof raw.baseUrl === 'string' && raw.baseUrl.trim() !== '' ? raw.baseUrl.trim().replace(/\/+$/, '') : null;
      const paths =
        raw.paths && typeof raw.paths === 'object' && !Array.isArray(raw.paths)
          ? (raw.paths as Record<string, string>)
          : {};
      return {
        enabled: raw.enabled === true && baseUrl !== null,
        baseUrl,
        paths,
        ttlMinutes: num(raw.ttlMinutes, 30, 1, 1440),
      };
    },

    getAttachmentOptions(): AttachmentOptions {
      const raw = option<Record<string, unknown>>('attachments', {});
      const totalBudgetMb = num(raw.totalBudgetMb, 50, 1, 2048);
      return { totalBudgetMb, totalBudgetBytes: totalBudgetMb * 1024 * 1024 };
    },

    /**
     * Grounding options. `enabled` defaults to TRUE — the description is deterministic, bounded,
     * permission-filtered and inspectable, which are the four properties that make an
     * on-by-default generated prompt section safe for an existing install (FR-036).
     */
    getGroundingOptions(): GroundingOptions {
      const raw = option<Record<string, unknown>>('grounding', {});
      return {
        enabled: raw.enabled !== false,
        maxChars: num(raw.maxChars, 24000, 2000, 80000),
      };
    },
  };

  return service;
};

export default configService;
