export type ProviderId = 'anthropic' | 'google' | 'openai';

export const PROVIDERS: ProviderId[] = ['anthropic', 'google', 'openai'];

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  anthropic: 'Anthropic',
  google: 'Google',
  openai: 'OpenAI',
};

export interface ModelOption {
  id: string;
  label: string;
}

/**
 * CURATED, hardcoded model lists per provider — intentionally NOT fetched from a /models endpoint.
 * These are the ids passed straight to each provider's API. Edit this map to add/remove models;
 * confirm exact ids against each provider's current API docs before relying on them in production.
 */
export const MODELS: Record<ProviderId, ModelOption[]> = {
  anthropic: [
    { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  ],
  openai: [
    { id: 'gpt-4.1', label: 'GPT-4.1' },
    { id: 'gpt-4o', label: 'GPT-4o' },
    { id: 'o4-mini', label: 'o4-mini' },
  ],
  google: [
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  ],
};
