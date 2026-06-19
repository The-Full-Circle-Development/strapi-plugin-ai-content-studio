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

export const PROVIDERS: ProviderId[] = ['anthropic', 'google', 'openai'];

const STORE_PARAMS = { type: 'plugin', name: 'ai-content-studio', key: 'settings' } as const;

const emptyProvider = (): ProviderState => ({ apiKeyEnc: null, isSet: false, enabled: false });

const defaults = (): StudioSettings => ({
  activeProvider: 'anthropic',
  activeModel: 'claude-sonnet-4-6',
  providers: {
    anthropic: emptyProvider(),
    google: emptyProvider(),
    openai: emptyProvider(),
  },
});

const configService = ({ strapi }: { strapi: Core.Strapi }) => {
  const store = () => strapi.store(STORE_PARAMS);
  const cryptoSvc = () => strapi.plugin('ai-content-studio').service('crypto');

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
  };

  return service;
};

export default configService;
