import type { Core } from '@strapi/strapi';

/**
 * Register the plugin's RBAC permission actions so they appear in Settings → Roles.
 * The settings actions should be granted to super-admin only (super-admin passes all checks
 * implicitly; the `is-super-admin` policy is the real enforcement on the settings routes).
 */
const bootstrap = async ({ strapi }: { strapi: Core.Strapi }) => {
  const actions = [
    {
      section: 'plugins',
      displayName: 'Use AI Content Studio chat',
      uid: 'chat.use',
      pluginName: 'ai-content-studio',
    },
    {
      section: 'plugins',
      displayName: 'Read AI Content Studio settings',
      uid: 'settings.read',
      pluginName: 'ai-content-studio',
    },
    {
      section: 'plugins',
      displayName: 'Update AI Content Studio settings',
      uid: 'settings.update',
      pluginName: 'ai-content-studio',
    },
  ];

  await strapi.admin.services.permission.actionProvider.registerMany(actions);
};

export default bootstrap;
