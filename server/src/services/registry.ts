import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Core } from '@strapi/strapi';
import type { ProviderId } from './config';
import { getDescriptor } from './providers';

export type ProviderConfigErrorCode =
  | 'NO_ACTIVE_PROVIDER'
  | 'PROVIDER_DISABLED'
  | 'MISSING_KEY'
  | 'MISSING_BASE_URL'
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

export interface ActiveModel {
  /** A LangChain chat-model INSTANCE, built from the descriptor's static constructor. */
  model: BaseChatModel;
  provider: ProviderId;
  modelId: string;
  /**
   * Whether the active model accepts image input, from the descriptor's DECLARED rule
   * (contracts/provider-layer.md §3). If false, attachments still work for setting/replacing media
   * by ordinal — we simply never send the image bytes to the model.
   */
  supportsVision: boolean;
}

/**
 * Resolves the active provider from persisted configuration, on EVERY request.
 *
 * There is deliberately no `switch` on provider identity here any more: the descriptor comes from
 * the table in `providers.ts`, which is the only file that knows a provider's name (FR-001,
 * contracts/provider-layer.md §1, §2). Adding a provider does not touch this file.
 *
 * All five `ProviderConfigError` codes are raised BEFORE generation begins (FR-010), so the editor
 * gets a configuration-shaped message rather than a truncated stream.
 */
const registryService = ({ strapi }: { strapi: Core.Strapi }) => ({
  /**
   * Builds the active language model from the persisted config, per request.
   * Rebuilt every call so a rotated key / changed model takes effect on the next message with no
   * restart and no redeploy (FR-007, SC-001).
   */
  async getActiveModel(): Promise<ActiveModel> {
    const configSvc = strapi.plugin('ai-content-studio').service('config');
    const cfg = await configSvc.get();
    const { activeProvider, activeModel, providers } = cfg;

    if (!activeProvider || !activeModel) {
      throw new ProviderConfigError(
        'No active AI provider/model is configured.',
        'NO_ACTIVE_PROVIDER'
      );
    }

    // The table is the allow-list: an id absent from it is refused, so an administrator cannot
    // introduce a provider the layer does not know (FR-002). A provider the adapter layer supports
    // but this distribution does not carry is simply ABSENT rather than offered and broken (FR-011).
    const descriptor = getDescriptor(activeProvider);
    if (!descriptor) {
      throw new ProviderConfigError(
        `Unknown provider "${activeProvider}". It is not available in this build.`,
        'UNKNOWN_PROVIDER'
      );
    }

    const entry = providers?.[activeProvider];
    if (!entry || entry.enabled === false) {
      throw new ProviderConfigError(
        `Provider "${activeProvider}" is not enabled. Enable it in AI Content Studio settings.`,
        'PROVIDER_DISABLED'
      );
    }

    // Decrypt ONLY the active provider's key.
    const apiKey = await configSvc.getDecryptedKey(activeProvider);
    if (!apiKey) {
      throw new ProviderConfigError(
        `Provider "${activeProvider}" has no API key set. Add it in AI Content Studio settings.`,
        'MISSING_KEY'
      );
    }

    const baseUrl = entry.baseUrl ?? null;
    if (descriptor.requiresBaseUrl && !baseUrl) {
      throw new ProviderConfigError(
        `Provider "${activeProvider}" requires a Base URL. Add it in the Base URL field in AI Content Studio settings.`,
        'MISSING_BASE_URL'
      );
    }

    // The descriptor's constructor performs NO network call, so a configuration error stays
    // distinguishable from a provider error (FR-010).
    return {
      model: descriptor.create({ apiKey, model: activeModel, baseUrl }),
      provider: activeProvider,
      modelId: activeModel,
      supportsVision: descriptor.supportsVision(activeModel),
    };
  },
});

export default registryService;
