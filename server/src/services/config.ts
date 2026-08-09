import type { Core } from '@strapi/strapi';

/**
 * Plugin configuration persisted in the Strapi plugin store.
 *
 * Raw settings (including encrypted keys) NEVER leave the server. The only client-facing
 * shape is produced by `getMaskedConfig()`.
 */

export type ProviderId = 'anthropic' | 'google' | 'openai';

export interface ProviderState {
  /** AES-256-GCM payload "iv:authTag:ciphertext" (base64), or null when unset. */
  apiKeyEnc: string | null;
  /** Derived on read from `apiKeyEnc != null`. */
  isSet: boolean;
  enabled: boolean;
}

export interface StudioSettings {
  activeProvider: ProviderId;
  activeModel: string;
  providers: Record<ProviderId, ProviderState>;
}

export interface MaskedProviderState {
  isSet: boolean;
  enabled: boolean;
  masked: string | null;
}

export interface MaskedStudioConfig {
  activeProvider: ProviderId;
  activeModel: string;
  providers: Record<ProviderId, MaskedProviderState>;
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

export interface AuditOptions {
  timeBudgetSeconds: number;
  timeBudgetMs: number;
}

export const PROVIDERS: ProviderId[] = ['anthropic', 'google', 'openai'];

const STORE_PARAMS = { type: 'plugin', name: 'ai-content-studio', key: 'settings' } as const;

const emptyProvider = (): ProviderState => ({ apiKeyEnc: null, isSet: false, enabled: false });

const defaults = (): StudioSettings => ({
  activeProvider: 'anthropic',
  activeModel: 'claude-sonnet-5',
  providers: {
    anthropic: emptyProvider(),
    google: emptyProvider(),
    openai: emptyProvider(),
  },
});

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

  /** Fills defaults for any missing field and derives `isSet` from the stored ciphertext. */
  const normalize = (raw: Partial<StudioSettings> | null | undefined): StudioSettings => {
    const base = defaults();
    if (!raw) {
      return base;
    }
    const merged: StudioSettings = {
      activeProvider: raw.activeProvider ?? base.activeProvider,
      activeModel: raw.activeModel ?? base.activeModel,
      providers: { ...base.providers },
    };
    for (const p of PROVIDERS) {
      const r = raw.providers?.[p];
      if (r) {
        merged.providers[p] = {
          apiKeyEnc: r.apiKeyEnc ?? null,
          isSet: r.apiKeyEnc != null,
          enabled: r.enabled ?? false,
        };
      }
    }
    return merged;
  };

  const service = {
    /** Raw settings including encrypted keys. SERVER-INTERNAL ONLY — never send to the client. */
    async get(): Promise<StudioSettings> {
      const raw = (await store().get({})) as Partial<StudioSettings> | null;
      return normalize(raw);
    },

    async set(next: StudioSettings): Promise<void> {
      await store().set({ value: next });
    },

    /** Encrypts and persists a provider's key. Pass null to clear it. */
    async setProviderKey(provider: ProviderId, plaintextKey: string | null): Promise<void> {
      const current = await service.get();
      const apiKeyEnc = plaintextKey ? cryptoSvc().encrypt(plaintextKey) : null;
      current.providers[provider] = {
        ...current.providers[provider],
        apiKeyEnc,
        isSet: apiKeyEnc != null,
      };
      await service.set(current);
    },

    async setProviderEnabled(provider: ProviderId, enabled: boolean): Promise<void> {
      const current = await service.get();
      current.providers[provider] = { ...current.providers[provider], enabled };
      await service.set(current);
    },

    async setActive(activeProvider: ProviderId, activeModel: string): Promise<void> {
      const current = await service.get();
      current.activeProvider = activeProvider;
      current.activeModel = activeModel;
      await service.set(current);
    },

    /** Decrypts and returns a provider's raw key, or null. SERVER-INTERNAL ONLY. */
    async getDecryptedKey(provider: ProviderId): Promise<string | null> {
      const current = await service.get();
      const enc = current.providers[provider]?.apiKeyEnc;
      if (!enc) {
        return null;
      }
      return cryptoSvc().decrypt(enc);
    },

    /** Safe-for-client view. NEVER includes raw or encrypted keys — masked + flags only. */
    async getMaskedConfig(): Promise<MaskedStudioConfig> {
      const current = await service.get();
      const providers = {} as Record<ProviderId, MaskedProviderState>;
      for (const p of PROVIDERS) {
        const st = current.providers[p];
        let masked: string | null = null;
        if (st.apiKeyEnc) {
          // Decrypt transiently only to mask — the plaintext never leaves this function.
          masked = cryptoSvc().maskKey(cryptoSvc().decrypt(st.apiKeyEnc));
        }
        providers[p] = { isSet: st.isSet, enabled: st.enabled, masked };
      }
      return {
        activeProvider: current.activeProvider,
        activeModel: current.activeModel,
        providers,
      };
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

    getAuditOptions(): AuditOptions {
      const raw = option<Record<string, unknown>>('audit', {});
      const timeBudgetSeconds = num(raw.timeBudgetSeconds, 120, 5, 900);
      return { timeBudgetSeconds, timeBudgetMs: timeBudgetSeconds * 1000 };
    },
  };

  return service;
};

export default configService;
