/**
 * Plugin config. The runtime configuration (provider, model, API keys) lives in the plugin store
 * and is managed from the Settings page. Everything here is static config, and EVERY option
 * defaults to the behaviour this plugin had before it existed, so upgrading is a no-op (FR-054).
 *
 *   showProviderErrorDetails — when true, the chat stream surfaces the REAL provider error message
 *   (redacted of anything key-like) to the UI instead of a generic message. Useful for debugging;
 *   keep it OFF in production.
 *
 *   preview.*      — front-end live preview of a pending change set. OFF by default: it is the only
 *                    option that opens a non-admin HTTP surface, so a project must opt in. With it
 *                    off, the panel shows the in-panel field-by-field comparison instead (FR-014).
 *   attachments.*  — per-conversation budget for files held in the browser before ingestion.
 *   grounding.*    — the generated description of THIS install's schema, embedded in the
 *                    assistant's instructions. ON by default (see below).
 *
 * REMOVED: `audit.*`. The QA scan and security audit capabilities are retired, so the key is
 * ignored. An unknown key is harmless, but remove it from `config/plugins.ts` — it no longer does
 * anything (see README → Breaking changes).
 *
 * Configure via env or per consumer in config/plugins.ts:
 *
 *   'ai-content-studio': {
 *     enabled: true,
 *     config: {
 *       showProviderErrorDetails: true,
 *       preview: {
 *         enabled: true,
 *         baseUrl: env('AI_STUDIO_PREVIEW_BASE_URL'),
 *         ttlMinutes: 30,
 *         paths: { 'api::page.page': '/:slug', 'api::blog-post.blog-post': '/blog/:slug' },
 *       },
 *       attachments: { totalBudgetMb: 50 },
 *       grounding: { enabled: true, maxChars: 24000 },
 *     },
 *   }
 */
export default {
  default: {
    showProviderErrorDetails: process.env.AI_STUDIO_SHOW_ERROR_DETAILS === 'true',
    preview: {
      /** Off by default — a project must opt in before any non-admin preview surface does anything. */
      enabled: false,
      /** Front-end origin previews are opened against, e.g. "https://staging.example.com". */
      baseUrl: process.env.AI_STUDIO_PREVIEW_BASE_URL,
      /** content-type uid -> path pattern, e.g. { 'api::page.page': '/:slug' }. */
      paths: {} as Record<string, string>,
      /** Lifetime of a preview session AND of a pending change set, in minutes. */
      ttlMinutes: 30,
    },
    attachments: {
      /** Total size of files held in the browser for one conversation, in megabytes. */
      totalBudgetMb: 50,
    },
    grounding: {
      /**
       * The HARD off-switch, set by the host application's developer at deploy time. An install
       * that must never carry a generated prompt section sets this `false`, and the runtime
       * settings Toggle can then only narrow it — never re-enable it
       * (contracts/install-description.md §7). With it off, the Toggle renders disabled and names
       * this key.
       *
       * ON by default (FR-036), justified: the description is deterministic, size-bounded,
       * permission-filtered and inspectable — the four properties that make an on-by-default
       * generated prompt section safe for an existing install.
       */
      enabled: true,
      /**
       * Declared character budget, clamped to 2,000..80,000. Chosen so the description cannot
       * crowd out a long conversation on a large install (SC-011) while comfortably fitting an
       * ordinary project in full. Exceeding it degrades by tier, deterministically, and says so.
       */
      maxChars: 24000,
    },
  },
  validator() {},
};
