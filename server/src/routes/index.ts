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
    ],
  },

  // The single token-gated non-admin surface. Exposes no chat, no tools, no settings.
  preview,
};
