import preview from './preview';

/**
 * Admin-API routes, mounted under `/ai-content-studio/*`.
 *
 * Gating (contracts/permissions.md):
 *   - every chat / thread / change-set / attachment route requires `admin::isAuthenticatedAdmin`
 *     AND the grantable `chat.use` action. Per-item content authorization happens deeper, against
 *     the caller's live ability: inside each tool for reads, and inside the apply path for writes.
 *   - `/settings` stays super-admin only and is untouched by this feature.
 *
 * Owner scoping is NOT a route concern — it is enforced in the services, which answer 404 (never
 * 403) for another user's resource so ids are not enumerable.
 */

const CHAT_USE = {
  name: 'admin::hasPermissions',
  config: { actions: ['plugin::ai-content-studio.chat.use'] },
};

const chatRoute = (method: string, path: string, handler: string) => ({
  method,
  path,
  handler,
  config: {
    policies: ['admin::isAuthenticatedAdmin', CHAT_USE],
  },
});

export default {
  admin: {
    type: 'admin',
    routes: [
      chatRoute('POST', '/chat', 'chat.chat'),

      // Threads — the caller's own conversations only.
      chatRoute('GET', '/threads', 'threads.find'),
      chatRoute('POST', '/threads', 'threads.create'),
      chatRoute('GET', '/threads/:id', 'threads.findOne'),
      chatRoute('PATCH', '/threads/:id', 'threads.update'),
      chatRoute('DELETE', '/threads/:id', 'threads.delete'),

      /**
       * Focus (005 contracts/situation-and-focus.md §1.2) — the one entry the editor is pointing
       * at, scoped to one conversation.
       *
       * Behind the SAME gate every chat and thread route carries: `admin::isAuthenticatedAdmin`
       * plus the grantable `chat.use` action. Nothing narrower is needed and nothing wider is safe.
       *
       * Owner scoping is NOT a route concern here either: the two `/threads/:id/focus` routes
       * resolve through `threads.getOwnedThread`, which answers **404, not 403**, for another
       * user's thread.
       *
       * The two `/focus/*` routes validate their uid against the live `api::*` allow-list and
       * RBAC-check the CALLER through `content-manager`'s `permission-checker` before touching the
       * Document Service — the same three steps every tool performs, in the same order. They are
       * read-only and return no field values beyond a display label.
       *
       * FOCUS GRANTS NOTHING (FR-017, FR-034): it is re-resolved and re-permission-checked on every
       * turn, it widens no tool, and it changes no write path. The apply route remains the sole
       * writer.
       */
      chatRoute('PUT', '/threads/:id/focus', 'threads.setFocus'),
      chatRoute('DELETE', '/threads/:id/focus', 'threads.clearFocus'),
      chatRoute('GET', '/focus/content-types', 'focus.contentTypes'),
      chatRoute('GET', '/focus/entries', 'focus.entries'),

      // Change plans. `apply` is the only route in this plugin that mutates content.
      chatRoute('GET', '/change-sets/:id', 'change-sets.findOne'),
      chatRoute('POST', '/change-sets/:id/apply', 'change-sets.apply'),
      chatRoute('POST', '/change-sets/:id/reject', 'change-sets.reject'),
      chatRoute('POST', '/change-sets/:id/preview', 'change-sets.preview'),

      // Attachments. `ingest` additionally requires the caller's Media Library create permission,
      // checked in the service before any byte is written.
      chatRoute('GET', '/attachments/limits', 'attachments.limits'),
      chatRoute('POST', '/attachments/ingest', 'attachments.ingest'),

      {
        method: 'GET',
        path: '/settings',
        handler: 'settings.find',
        config: {
          policies: ['admin::isAuthenticatedAdmin', 'plugin::ai-content-studio.is-super-admin'],
        },
      },
      {
        method: 'PUT',
        path: '/settings',
        handler: 'settings.update',
        config: {
          policies: ['admin::isAuthenticatedAdmin', 'plugin::ai-content-studio.is-super-admin'],
        },
      },

      /**
       * The grounding inspector (FR-035). A NARROWER gate than the super-admin-only `/settings`
       * routes above, and the only new non-super-admin surface in this feature.
       *
       * It is scoped to the CALLING account: it returns the description that account's own requests
       * carry, so it is not a way to read a schema they cannot otherwise read. It exposes no
       * credential and no content — the description is schema-only by construction.
       */
      {
        method: 'GET',
        path: '/settings/grounding',
        handler: 'settings.grounding',
        config: {
          policies: [
            'admin::isAuthenticatedAdmin',
            {
              name: 'admin::hasPermissions',
              config: { actions: ['plugin::ai-content-studio.settings.read'] },
            },
          ],
        },
      },

      /**
       * The content brief (contracts/content-brief.md §5). SUPER-ADMIN ONLY, the same gate the
       * provider settings carry and deliberately NOT the narrower `chat.use`:
       *
       *   - `run` spends provider money and walks every content type the runner can read. That is
       *     an operator action with a bill attached, not a chat action.
       *   - `status` returns the generated prose ABOUT CONTENT, which by default is one briefing
       *     shared by every account (contracts/content-brief.md §3). Super-admin is therefore the
       *     right gate for the surface that shows it whole and can rewrite it — not because the
       *     text is secret from chat users, who are given the same briefing in their prompts, but
       *     because running and inspecting it is an operator's job with a bill attached.
       */
      {
        method: 'GET',
        path: '/content-brief',
        handler: 'content-brief.status',
        config: {
          policies: ['admin::isAuthenticatedAdmin', 'plugin::ai-content-studio.is-super-admin'],
        },
      },
      {
        method: 'POST',
        path: '/content-brief/run',
        handler: 'content-brief.run',
        config: {
          policies: ['admin::isAuthenticatedAdmin', 'plugin::ai-content-studio.is-super-admin'],
        },
      },
    ],
  },

  // The single token-gated non-admin surface. Exposes no chat, no tools, no settings.
  preview,
};
