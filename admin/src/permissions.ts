import type { Permission } from '@strapi/strapi/admin';

/**
 * RBAC permission descriptors. These must match the actions registered in the server's
 * bootstrap (`plugin::ai-content-studio.*`). The settings actions should be granted to
 * super-admin only; super-admin passes all RBAC checks implicitly.
 */
export const PERMISSIONS: Record<'chat' | 'settingsRead' | 'settingsUpdate', Permission[]> = {
  chat: [{ action: 'plugin::ai-content-studio.chat.use', subject: null }],
  settingsRead: [{ action: 'plugin::ai-content-studio.settings.read', subject: null }],
  settingsUpdate: [{ action: 'plugin::ai-content-studio.settings.update', subject: null }],
};
