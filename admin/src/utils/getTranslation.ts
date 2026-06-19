import { PLUGIN_ID } from '../pluginId';

/** Namespaces a translation id under the plugin id. */
export const getTranslation = (id: string): string => `${PLUGIN_ID}.${id}`;

/** Prefixes every key of a translation file with the plugin id (Strapi 5.42 does not export this). */
export const prefixPluginTranslations = (
  trad: Record<string, string>,
  pluginId: string
): Record<string, string> =>
  Object.keys(trad).reduce<Record<string, string>>((acc, key) => {
    acc[`${pluginId}.${key}`] = trad[key];
    return acc;
  }, {});
