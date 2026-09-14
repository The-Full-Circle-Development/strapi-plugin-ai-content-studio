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
 *   contentBrief.* — the model-written briefing about what this install's CONTENT actually is. The
 *                    key is on by default but grants nothing on its own: an install has no brief
 *                    until an administrator runs one from Settings, and the stored source defaults
 *                    to `schema`, so an upgrade changes no prompt and spends no provider token.
 *                    This is the only feature in the plugin that can spend money without a click —
 *                    `autoRefresh` is what does it, and turning it off keeps the manual button.
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
 *       contentBrief: {
 *         enabled: true,
 *         maxChars: 24000,
 *         maxSectionChars: 1200,
 *         autoRefresh: true,
 *         refreshThrottleMinutes: 60,
 *         maxAutoRefreshSections: 3,
 *         scopeToReader: false,   // false = one brief, identical for every account
 *       },
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
    contentBrief: {
      /**
       * The HARD off-switch for the whole feature, the same shape `grounding.enabled` has. With it
       * off, the Run control renders disabled and names this key, and no brief text can reach a
       * prompt even if one was generated before the key was set.
       *
       * ON by default, and unlike grounding that costs nothing on its own: an install has no brief
       * until someone presses Run, and the stored source defaults to `schema`.
       */
      enabled: true,
      /** Declared character budget for the ASSEMBLED brief, clamped 2,000..80,000. Its own budget,
       *  separate from `grounding.maxChars`, so selecting both cannot double one ceiling. */
      maxChars: 24000,
      /** Per-section ceiling, so one verbose section cannot consume the whole budget. */
      maxSectionChars: 1200,
      /**
       * ⚠ THE ONLY SETTING IN THIS PLUGIN THAT SPENDS PROVIDER MONEY WITHOUT A CLICK.
       *
       * With it on, sections whose schema or content fingerprint moved are regenerated during chat
       * sessions, bounded by the two keys below. With it off, a stale brief stays stale and says so
       * in Settings until an administrator re-runs it — nothing else changes.
       */
      autoRefresh: true,
      /** Floor between two automatic passes, in minutes. A human pressing Run is never throttled. */
      refreshThrottleMinutes: 60,
      /** Hard ceiling on sections ONE automatic pass may regenerate — the unattended-spend bound. */
      maxAutoRefreshSections: 3,
      /**
       * ONE BRIEF, THE SAME FOR EVERY ACCOUNT — the default, and `false` is that default.
       *
       * The briefing describes the platform, so every account with chat access reads the same text,
       * project overview included. It never describes a content type the super-admin who ran it
       * could not read, and it changes nothing about what the assistant may DO: every tool still
       * RBAC-checks the calling account before touching content.
       *
       * Set `true` where that disclosure is not acceptable — multi-tenant, or a content type only
       * one team may know exists. Each reader is then served only the sections their own
       * permissions allow, and the project overview is withheld entirely, because it is synthesized
       * across every content type and so cannot be filtered.
       */
      scopeToReader: false,
    },
  },
  validator() {},
};
