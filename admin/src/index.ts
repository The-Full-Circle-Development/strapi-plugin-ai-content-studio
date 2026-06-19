import { PLUGIN_ID } from './pluginId';
import { PERMISSIONS } from './permissions';
import { getTranslation, prefixPluginTranslations } from './utils/getTranslation';
import { PluginIcon } from './components/PluginIcon';

export default {
  register(app: any) {
    // Main nav: the chat workspace (available to any role granted chat.use).
    app.addMenuLink({
      to: `plugins/${PLUGIN_ID}`,
      icon: PluginIcon,
      intlLabel: { id: getTranslation('menu.label'), defaultMessage: 'AI Studio' },
      permissions: PERMISSIONS.chat,
      Component: () => import('./pages/Chat').then((mod) => ({ default: mod.Chat })),
    });

    // Settings section: provider/model + API keys (super-admin only via permissions).
    app.addSettingsLink(
      {
        id: PLUGIN_ID,
        intlLabel: { id: getTranslation('settings.section'), defaultMessage: 'AI Content Studio' },
      },
      {
        id: `${PLUGIN_ID}.settings`,
        to: PLUGIN_ID,
        intlLabel: { id: getTranslation('settings.link'), defaultMessage: 'Configuration' },
        permissions: PERMISSIONS.settingsRead,
        Component: () => import('./pages/Settings').then((mod) => ({ default: mod.Settings })),
      }
    );

    app.registerPlugin({
      id: PLUGIN_ID,
      name: 'AI Content Studio',
    });
  },

  bootstrap(_app: any) {},

  async registerTrads({ locales }: { locales: string[] }) {
    return Promise.all(
      locales.map(async (locale) => {
        try {
          const { default: data } = await import(`./translations/${locale}.json`);
          return { data: prefixPluginTranslations(data, PLUGIN_ID), locale };
        } catch {
          return { data: {}, locale };
        }
      })
    );
  },
};
