import { MODELS } from './models';

/**
 * The shipped-provider catalog for the settings screen — the client's mirror of the server's
 * declarative table in `server/src/services/providers.ts`.
 *
 * THIS IS A SEPARATE MODULE FROM `models.ts` ON PURPOSE (research D15).
 * `.claude/hooks/session-model-context.mjs` parses `models.ts` as *text*, starting at
 * `source.indexOf('export const MODELS')` and scanning to END OF FILE with no terminator. Any
 * later line matching `/^\s*([A-Za-z_$][\w$]*)\s*:\s*\[/` is read as a phantom provider group, so a
 * provider catalog appended to that file would corrupt the session reminder — silently, because the
 * hook degrades to emitting its standing rule alone rather than failing. Nothing may be appended to
 * `models.ts`, and its `MODELS` literal may not be restructured.
 *
 * NO MODEL IDENTIFIER APPEARS IN THIS FILE. It describes providers; the curated lists have exactly
 * one home (CLAUDE.md).
 */

export interface ProviderCatalogEntry {
  /** Matches the server descriptor's `id` exactly — it is the persisted settings key. */
  id: string;
  /** English display name (FR-025). */
  label: string;
  /** When true, the settings screen marks the Base URL field required (FR-008, FR-010). */
  requiresBaseUrl: boolean;
  /**
   * Derived, never stored: whether a curated model list exists for this provider.
   *
   * `false` means the settings screen offers DIRECT IDENTIFIER ENTRY and says so in English
   * (FR-004) — which is also the code path that keeps a saved non-curated identifier working
   * verbatim after it is dropped from a curated list in a later release (FR-005).
   */
  hasCuratedModels: boolean;
}

/** Widened lookup: the catalog carries ids that `models.ts`'s own literal union does not. */
const curatedFor = (id: string): boolean =>
  (MODELS as Record<string, unknown[] | undefined>)[id] != null;

/**
 * The four providers this distribution ships. The first three keep their existing ids so no
 * install's saved selection is orphaned.
 *
 * A provider the adapter layer supports but this build does not carry is ABSENT from the selection
 * rather than offered and broken (FR-011).
 */
export const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  { id: 'anthropic', label: 'Anthropic', requiresBaseUrl: false, hasCuratedModels: curatedFor('anthropic') },
  { id: 'openai', label: 'OpenAI', requiresBaseUrl: false, hasCuratedModels: curatedFor('openai') },
  { id: 'google', label: 'Google', requiresBaseUrl: false, hasCuratedModels: curatedFor('google') },
  {
    /**
     * The unbounded tail — any endpoint speaking the OpenAI wire format, reached with no
     * per-provider code (research D3). It ships no curated list by design: the plugin cannot know
     * what a given endpoint serves, so the model identifier is entered directly.
     */
    id: 'openai-compatible',
    label: 'OpenAI-compatible endpoint',
    requiresBaseUrl: true,
    hasCuratedModels: curatedFor('openai-compatible'),
  },
];

export const getProviderEntry = (id: string | null | undefined): ProviderCatalogEntry | null =>
  PROVIDER_CATALOG.find((p) => p.id === id) ?? null;
