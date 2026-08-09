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
 * verify every id against the provider's live catalog before shipping it — never from memory.
 *
 * INVARIANTS (see specs/002-model-catalog-refresh/contracts/model-catalog.md):
 *  - Every provider array has at least one entry. Settings.tsx indexes `MODELS[next][0].id`
 *    unguarded on provider switch, so an empty array throws.
 *  - Ids are unique within a provider (they become React keys) and are passed verbatim to the
 *    provider SDK — never normalized, lowercased, or date-suffixed.
 *  - This map is NOT an allow-list for the saved `activeModel`. An install may hold any id the
 *    provider accepts, curated or not, and it must keep working.
 *
 * PARSEABILITY CONTRACT: `.claude/hooks/session-model-context.mjs` reads this file as *text* so
 * that no second copy of the catalog exists anywhere. That makes the formatting below a contract:
 *  - entries stay single-line `{ id: '…', label: '…' }` object literals,
 *  - ids stay single-quoted string literals on the same line as their label,
 *  - provider keys stay bare identifiers (`anthropic:`, `openai:`, `google:`).
 * Do not refactor MODELS into a computed value, a spread of imported fragments, or a generated
 * structure without updating that hook in the same change. The hook degrades to emitting its
 * standing rule alone rather than failing, so a break here is silent: it costs the reminder's
 * accuracy without breaking the build.
 */
export const MODELS: Record<ProviderId, ModelOption[]> = {
  anthropic: [
    { id: 'claude-opus-5', label: 'Claude Opus 5' },
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
    { id: 'claude-fable-5', label: 'Claude Fable 5' },
    { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  ],
  openai: [
    { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
    { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
    { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
    { id: 'gpt-5.4', label: 'GPT-5.4' },
  ],
  google: [
    // Gemini 3.x — latest generation
    { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
    { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
    { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite' },
    { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite' },
    // Gemini 2.5 — stable workhorses
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
  ],
};
