import { createProviderRegistry, type LanguageModel } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { Core } from '@strapi/strapi';
import type { ProviderId } from './config';

export type ProviderConfigErrorCode =
  | 'NO_ACTIVE_PROVIDER'
  | 'PROVIDER_DISABLED'
  | 'MISSING_KEY'
  | 'UNKNOWN_PROVIDER';

/** Thrown for configuration problems. Messages name the provider, NEVER the key. */
export class ProviderConfigError extends Error {
  code: ProviderConfigErrorCode;
  constructor(message: string, code: ProviderConfigErrorCode) {
    super(message);
    this.name = 'ProviderConfigError';
    this.code = code;
  }
}

const registryService = ({ strapi }: { strapi: Core.Strapi }) => ({
  /**
   * Builds the active language model from the persisted config, per request.
   * Rebuilt every call so a rotated key / changed model takes effect on the next message.
   */
  async getActiveModel(): Promise<LanguageModel> {
    const configSvc = strapi.plugin('ai-content-studio').service('config');
    const cfg = await configSvc.get();
    const { activeProvider, activeModel, providers } = cfg;

    if (!activeProvider || !activeModel) {
      throw new ProviderConfigError(
        'No active AI provider/model is configured.',
        'NO_ACTIVE_PROVIDER'
      );
    }

    const entry = providers?.[activeProvider as ProviderId];
    if (!entry || entry.enabled === false) {
      throw new ProviderConfigError(
        `Provider "${activeProvider}" is not enabled. Enable it in AI Content Studio settings.`,
        'PROVIDER_DISABLED'
      );
    }

    // Decrypt ONLY the active provider's key.
    const apiKey = await configSvc.getDecryptedKey(activeProvider as ProviderId);
    if (!apiKey) {
      throw new ProviderConfigError(
        `Provider "${activeProvider}" has no API key set. Add it in AI Content Studio settings.`,
        'MISSING_KEY'
      );
    }

    const factories: Record<string, ReturnType<typeof createAnthropic>> = {};
    switch (activeProvider) {
      case 'anthropic':
        factories.anthropic = createAnthropic({ apiKey });
        break;
      case 'openai':
        factories.openai = createOpenAI({ apiKey }) as never;
        break;
      case 'google':
        factories.google = createGoogleGenerativeAI({ apiKey }) as never;
        break;
      default:
        throw new ProviderConfigError(`Unknown provider "${activeProvider}".`, 'UNKNOWN_PROVIDER');
    }

    const registry = createProviderRegistry(factories as never);
    return registry.languageModel(`${activeProvider}:${activeModel}` as never);
  },
});

export default registryService;
