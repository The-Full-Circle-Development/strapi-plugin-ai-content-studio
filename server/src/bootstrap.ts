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
    {
      // A list of a project's permission leaks and weak configuration is itself sensitive
      // (spec decision D3), so the security audit gets its own grantable action rather than
      // riding on chat.use. Assign it to super-admin only unless you mean to delegate it.
      section: 'plugins',
      displayName: 'Run AI Content Studio security audit',
      uid: 'audit.run',
      pluginName: 'ai-content-studio',
    },
  ];

  await strapi.admin.services.permission.actionProvider.registerMany(actions);
};

export default bootstrap;
