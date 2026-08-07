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
 *   audit.*        — deadline for a QA / security pass, so a scan inside a chat turn is bounded.
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
 *       audit: { timeBudgetSeconds: 120 },
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
    audit: {
      /** Wall-clock deadline for one QA / security pass. Whatever it misses is reported uncovered. */
      timeBudgetSeconds: 120,
    },
  },
  validator() {},
};
