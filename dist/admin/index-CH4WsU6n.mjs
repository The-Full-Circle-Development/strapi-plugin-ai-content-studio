import { jsx } from "react/jsx-runtime";
import { Sparkle } from "@strapi/icons";
const __variableDynamicImportRuntimeHelper = (glob, path, segs) => {
  const v = glob[path];
  if (v) {
    return typeof v === "function" ? v() : Promise.resolve(v);
  }
  return new Promise((_, reject) => {
    (typeof queueMicrotask === "function" ? queueMicrotask : setTimeout)(
      reject.bind(
        null,
        new Error(
          "Unknown variable dynamic import: " + path + (path.split("/").length !== segs ? ". Note that variables only represent file names one level deep." : "")
        )
      )
    );
  });
};
const PLUGIN_ID = "ai-content-studio";
const PERMISSIONS = {
  chat: [{ action: "plugin::ai-content-studio.chat.use", subject: null }],
  settingsRead: [{ action: "plugin::ai-content-studio.settings.read", subject: null }]
};
const getTranslation = (id) => `${PLUGIN_ID}.${id}`;
const prefixPluginTranslations = (trad, pluginId) => Object.keys(trad).reduce((acc, key) => {
  acc[`${pluginId}.${key}`] = trad[key];
  return acc;
}, {});
const PluginIcon = () => /* @__PURE__ */ jsx(Sparkle, {});
const index = {
  register(app) {
    app.addMenuLink({
      to: `plugins/${PLUGIN_ID}`,
      icon: PluginIcon,
      intlLabel: { id: getTranslation("menu.label"), defaultMessage: "AI Studio" },
      permissions: PERMISSIONS.chat,
      Component: () => import("./Chat-CUReP2V9.mjs").then((mod) => ({ default: mod.Chat }))
    });
    app.addSettingsLink(
      {
        id: PLUGIN_ID,
        intlLabel: { id: getTranslation("settings.section"), defaultMessage: "AI Content Studio" }
      },
      {
        id: `${PLUGIN_ID}.settings`,
        to: PLUGIN_ID,
        intlLabel: { id: getTranslation("settings.link"), defaultMessage: "Configuration" },
        permissions: PERMISSIONS.settingsRead,
        Component: () => import("./Settings-CzWDp6XY.mjs").then((mod) => ({ default: mod.Settings }))
      }
    );
    app.registerPlugin({
      id: PLUGIN_ID,
      name: "AI Content Studio"
    });
  },
  bootstrap(_app) {
  },
  async registerTrads({ locales }) {
    return Promise.all(
      locales.map(async (locale) => {
        try {
          const { default: data } = await __variableDynamicImportRuntimeHelper(/* @__PURE__ */ Object.assign({ "./translations/en.json": () => import("./en-CIB-6s-p.mjs") }), `./translations/${locale}.json`, 3);
          return { data: prefixPluginTranslations(data, PLUGIN_ID), locale };
        } catch {
          return { data: {}, locale };
        }
      })
    );
  }
};
export {
  PERMISSIONS as P,
  getTranslation as g,
  index as i
};
