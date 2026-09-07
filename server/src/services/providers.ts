import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import type { ProviderDescriptor } from '../types';

/**
 * The declarative provider table — the WHOLE provider surface
 * (contracts/provider-layer.md §1). Nothing else in the repository knows a provider's name.
 *
 *   Adding a provider is exactly two edits, in this one file:
 *     1. a static import of its @langchain/* chat model
 *     2. one row in PROVIDER_DESCRIPTORS
 *
 * FORBIDDEN, absolutely:
 *  - a `switch` or `if` on provider identity anywhere in a chat, prompt, tool, approval or
 *    interface path (FR-001). The old `switch (activeProvider)` in `registry.ts` is DELETED,
 *    not moved.
 *  - `initChatModel`, or any dynamic `import()` whose specifier is a variable. esbuild cannot
 *    bundle it, so the package would be absent from the committed `dist/` and the provider would
 *    fail at runtime in a consumer's app (research D2). Every import above is static for exactly
 *    this reason.
 *  - fetching a model catalog from any provider endpoint (FR-003, Principle III).
 *  - letting an administrator name a provider, class or package to load (FR-002).
 *
 * NO MODEL IDENTIFIER APPEARS IN THIS FILE. The `supportsVision` rules below are PREFIXES AND
 * SHAPES, not identifiers, and they are ported from the function named in the header of each rule
 * rather than recalled. The curated lists have exactly one home, `admin/src/data/models.ts`
 * (CLAUDE.md).
 */

/**
 * Image-input capability, declared per provider and DEFAULT-DENY (FR-006,
 * contracts/provider-layer.md §3).
 *
 * These four rules are ported VERBATIM from the single prefix-matching `modelSupportsVision()`
 * that used to live in `registry.ts` and branch on provider identity. Porting rather than
 * re-deriving is the contract, not a convenience: image input works on all three first-party
 * providers today, and FR-009's "identical behaviour to before this change" includes that.
 *
 * A descriptor left at bare default-deny passes every NEGATIVE test — the images are simply
 * withheld, correctly and quietly, from models that could have read them. That silent regression
 * is what `providers.test.ts` and quickstart A13 exist to catch.
 *
 * A wrong `true` is the worse failure: it sends image bytes to a model that rejects them and fails
 * the whole request. So any new identifier must be checked against its provider's rule before it
 * ships.
 */
const visionRules = {
  /** Every Anthropic chat model is multimodal. */
  anthropic: (m: string): boolean => m.startsWith('claude-'),

  /** Every Gemini chat model is multimodal. */
  google: (m: string): boolean => m.startsWith('gemini-'),

  /**
   * Modern OpenAI chat families accept images; the older 3.5 line and the non-text families do
   * not. Both exclusions are checked BEFORE the positive test, so an id that matches a family
   * prefix and an exclusion is denied.
   */
  openai: (m: string): boolean => {
    if (m.startsWith('gpt-3.5')) {
      return false;
    }
    if (/embedding|tts|whisper|moderation|audio|realtime/.test(m)) {
      return false;
    }
    return m.startsWith('gpt-4') || m.startsWith('gpt-5') || /^o\d/.test(m);
  },

  /**
   * Never. The plugin cannot know what an arbitrary endpoint accepts, and a wrong `true` fails the
   * whole request. Placement by filename still works, which is the graceful degradation
   * Principle III requires.
   */
  openaiCompatible: (_m: string): boolean => false,
} as const;

/** Lowercase once, at the boundary, so each rule above reads a normalized identifier. */
const vision = (rule: (m: string) => boolean) => (model: string): boolean => rule(model.toLowerCase());

export const PROVIDER_DESCRIPTORS: readonly ProviderDescriptor[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    create: ({ apiKey, model }) => new ChatAnthropic({ apiKey, model }),
    requiresBaseUrl: false,
    supportsVision: vision(visionRules.anthropic),
  },
  {
    id: 'openai',
    label: 'OpenAI',
    create: ({ apiKey, model, baseUrl }) =>
      new ChatOpenAI({
        apiKey,
        model,
        // Accepted on a `requiresBaseUrl: false` provider too, so a self-hosted deployment of a
        // first-party provider is possible with no new code (contracts/provider-layer.md §4).
        ...(baseUrl ? { configuration: { baseURL: baseUrl } } : {}),
      }),
    requiresBaseUrl: false,
    supportsVision: vision(visionRules.openai),
  },
  {
    id: 'google',
    label: 'Google',
    create: ({ apiKey, model, baseUrl }) =>
      new ChatGoogleGenerativeAI({ apiKey, model, ...(baseUrl ? { baseUrl } : {}) }),
    requiresBaseUrl: false,
    supportsVision: vision(visionRules.google),
  },
  {
    id: 'openai-compatible',
    label: 'OpenAI-compatible endpoint',
    /**
     * The unbounded tail — Groq, Mistral, DeepSeek, Together, Fireworks, Perplexity, Cerebras,
     * xAI, OpenRouter, Ollama, vLLM, LM Studio and any self-hosted server speaking the same wire
     * format — reached with ZERO per-provider code (research D3).
     *
     * THE LOAD-BEARING INVARIANT: `useResponsesApi` must stay at its verified default of `false`.
     * A third-party or self-hosted compatible endpoint implements `/chat/completions`, not
     * `/responses`, so anything that forces the Responses surface breaks the entire long tail. It
     * is left unset here deliberately — do not pass it, and do not request a feature that forces
     * that surface on this provider.
     */
    create: ({ apiKey, model, baseUrl }) =>
      new ChatOpenAI({ apiKey, model, configuration: { baseURL: baseUrl ?? undefined } }),
    requiresBaseUrl: true,
    supportsVision: vision(visionRules.openaiCompatible),
  },
];

/**
 * The table is the ALLOW-LIST for `activeProvider`: an id absent from it is `UNKNOWN_PROVIDER`,
 * refused before generation, so an administrator cannot introduce a provider the layer does not
 * know (FR-002).
 *
 * It is NEVER an allow-list for a model identifier — any saved identifier is passed to the
 * provider verbatim (FR-004, FR-005).
 */
export const PROVIDER_IDS: readonly string[] = PROVIDER_DESCRIPTORS.map((p) => p.id);

/** The descriptor for a saved id, or null when the distribution does not carry it. */
export const getDescriptor = (id: string | null | undefined): ProviderDescriptor | null =>
  PROVIDER_DESCRIPTORS.find((p) => p.id === id) ?? null;
