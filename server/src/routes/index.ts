/**
 * Admin-API routes, mounted under `/ai-content-studio/*`.
 *
 * - `/chat`     — any authenticated admin (editors included). Per-action authorization happens
 *                 inside each tool via the content-manager permission-checker.
 * - `/settings` — super-admin only (GET masked config, PUT save).
 */
export default {
  admin: {
    type: 'admin',
    routes: [
      {
        method: 'POST',
        path: '/chat',
        handler: 'chat.chat',
        config: {
          policies: ['admin::isAuthenticatedAdmin'],
        },
      },
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
    ],
  },
};
