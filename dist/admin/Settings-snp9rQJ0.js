"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const jsxRuntime = require("react/jsx-runtime");
const React = require("react");
const reactIntl = require("react-intl");
const admin = require("@strapi/strapi/admin");
const designSystem = require("@strapi/design-system");
const index = require("./index-B-JLusQF.js");
function _interopNamespace(e) {
  if (e && e.__esModule) return e;
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const React__namespace = /* @__PURE__ */ _interopNamespace(React);
const PROVIDERS = ["anthropic", "google", "openai"];
const PROVIDER_LABELS = {
  anthropic: "Anthropic",
  google: "Google",
  openai: "OpenAI"
};
const MODELS = {
  anthropic: [
    { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" }
  ],
  openai: [
    { id: "gpt-4.1", label: "GPT-4.1" },
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "o4-mini", label: "o4-mini" }
  ],
  google: [
    // Gemini 3.x — latest generation
    { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
    { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (preview)" },
    { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite" },
    { id: "gemini-3-flash-preview", label: "Gemini 3 Flash (preview)" },
    // Gemini 2.5 — stable workhorses
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" }
  ]
};
const emptyByProvider = (value) => PROVIDERS.reduce((acc, p) => {
  acc[p] = value;
  return acc;
}, {});
const SettingsForm = () => {
  const { formatMessage } = reactIntl.useIntl();
  const { get, put } = admin.useFetchClient();
  const { toggleNotification } = admin.useNotification();
  const [loading, setLoading] = React__namespace.useState(true);
  const [saving, setSaving] = React__namespace.useState(false);
  const [server, setServer] = React__namespace.useState(null);
  const [activeProvider, setActiveProvider] = React__namespace.useState("anthropic");
  const [activeModel, setActiveModel] = React__namespace.useState("");
  const [enabled, setEnabled] = React__namespace.useState(emptyByProvider(false));
  const [keyInput, setKeyInput] = React__namespace.useState(emptyByProvider(""));
  const [keyDirty, setKeyDirty] = React__namespace.useState(emptyByProvider(false));
  const hydrate = React__namespace.useCallback((data) => {
    setServer(data);
    setActiveProvider(data.activeProvider);
    setActiveModel(data.activeModel);
    setEnabled(PROVIDERS.reduce((acc, p) => {
      acc[p] = data.providers[p]?.enabled ?? false;
      return acc;
    }, {}));
    setKeyInput(emptyByProvider(""));
    setKeyDirty(emptyByProvider(false));
  }, []);
  React__namespace.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data } = await get("/ai-content-studio/settings");
        if (active) {
          hydrate(data);
        }
      } catch {
        toggleNotification({
          type: "danger",
          message: formatMessage({
            id: index.getTranslation("settings.loadError"),
            defaultMessage: "Failed to load AI settings."
          })
        });
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [get, hydrate, toggleNotification, formatMessage]);
  const onSave = async () => {
    setSaving(true);
    try {
      const providers = {};
      for (const p of PROVIDERS) {
        const patch = {};
        if (server && enabled[p] !== server.providers[p]?.enabled) {
          patch.enabled = enabled[p];
        }
        if (keyDirty[p] && keyInput[p].trim() !== "") {
          patch.apiKey = keyInput[p].trim();
        }
        if (Object.keys(patch).length > 0) {
          providers[p] = patch;
        }
      }
      const body = {};
      if (server && activeProvider !== server.activeProvider) {
        body.activeProvider = activeProvider;
      }
      if (server && activeModel !== server.activeModel) {
        body.activeModel = activeModel;
      }
      if (Object.keys(providers).length > 0) {
        body.providers = providers;
      }
      const { data } = await put("/ai-content-studio/settings", body);
      hydrate(data);
      toggleNotification({
        type: "success",
        message: formatMessage({
          id: index.getTranslation("settings.saveSuccess"),
          defaultMessage: "AI settings saved."
        })
      });
    } catch {
      toggleNotification({
        type: "danger",
        message: formatMessage({
          id: index.getTranslation("settings.saveError"),
          defaultMessage: "Could not save AI settings."
        })
      });
    } finally {
      setSaving(false);
    }
  };
  if (loading) {
    return /* @__PURE__ */ jsxRuntime.jsx(admin.Page.Loading, {});
  }
  return /* @__PURE__ */ jsxRuntime.jsx(admin.Page.Main, { children: /* @__PURE__ */ jsxRuntime.jsxs(designSystem.Box, { padding: 6, children: [
    /* @__PURE__ */ jsxRuntime.jsx(designSystem.Typography, { variant: "alpha", tag: "h1", children: formatMessage({
      id: index.getTranslation("settings.title"),
      defaultMessage: "AI Content Studio — Configuration"
    }) }),
    /* @__PURE__ */ jsxRuntime.jsx(designSystem.Box, { paddingTop: 2, children: /* @__PURE__ */ jsxRuntime.jsx(designSystem.Typography, { variant: "epsilon", textColor: "neutral600", children: formatMessage({
      id: index.getTranslation("settings.subtitle"),
      defaultMessage: "Choose the active provider and model, and manage API keys. Keys are encrypted at rest and never shown again."
    }) }) }),
    /* @__PURE__ */ jsxRuntime.jsxs(designSystem.Flex, { direction: "column", alignItems: "stretch", gap: 5, marginTop: 6, children: [
      /* @__PURE__ */ jsxRuntime.jsxs(designSystem.Field.Root, { name: "activeProvider", children: [
        /* @__PURE__ */ jsxRuntime.jsx(designSystem.Field.Label, { children: formatMessage({ id: index.getTranslation("settings.activeProvider"), defaultMessage: "Active provider" }) }),
        /* @__PURE__ */ jsxRuntime.jsx(
          designSystem.SingleSelect,
          {
            value: activeProvider,
            onChange: (value) => {
              const next = String(value);
              setActiveProvider(next);
              if (!MODELS[next].some((m) => m.id === activeModel)) {
                setActiveModel(MODELS[next][0].id);
              }
            },
            children: PROVIDERS.map((p) => /* @__PURE__ */ jsxRuntime.jsx(designSystem.SingleSelectOption, { value: p, children: PROVIDER_LABELS[p] }, p))
          }
        )
      ] }),
      /* @__PURE__ */ jsxRuntime.jsxs(designSystem.Field.Root, { name: "activeModel", children: [
        /* @__PURE__ */ jsxRuntime.jsx(designSystem.Field.Label, { children: formatMessage({ id: index.getTranslation("settings.activeModel"), defaultMessage: "Active model" }) }),
        /* @__PURE__ */ jsxRuntime.jsx(designSystem.SingleSelect, { value: activeModel, onChange: (value) => setActiveModel(String(value)), children: MODELS[activeProvider].map((m) => /* @__PURE__ */ jsxRuntime.jsx(designSystem.SingleSelectOption, { value: m.id, children: m.label }, m.id)) })
      ] }),
      PROVIDERS.map((p) => {
        const ps = server?.providers[p];
        return /* @__PURE__ */ jsxRuntime.jsxs(designSystem.Box, { padding: 4, hasRadius: true, background: "neutral0", borderColor: "neutral200", children: [
          /* @__PURE__ */ jsxRuntime.jsxs(designSystem.Flex, { justifyContent: "space-between", alignItems: "center", children: [
            /* @__PURE__ */ jsxRuntime.jsx(designSystem.Typography, { variant: "delta", children: PROVIDER_LABELS[p] }),
            /* @__PURE__ */ jsxRuntime.jsx(
              designSystem.Toggle,
              {
                name: `${p}-enabled`,
                onLabel: "On",
                offLabel: "Off",
                checked: enabled[p] ?? false,
                onChange: () => setEnabled((s) => ({ ...s, [p]: !s[p] }))
              }
            )
          ] }),
          /* @__PURE__ */ jsxRuntime.jsx(designSystem.Box, { marginTop: 3, children: /* @__PURE__ */ jsxRuntime.jsxs(
            designSystem.Field.Root,
            {
              name: `${p}-apiKey`,
              hint: ps?.isSet ? "A key is stored. Type a new value only to replace it." : "Write-only — the key is encrypted and never displayed again.",
              children: [
                /* @__PURE__ */ jsxRuntime.jsx(designSystem.Field.Label, { children: formatMessage({ id: index.getTranslation("settings.apiKey"), defaultMessage: "API key" }) }),
                /* @__PURE__ */ jsxRuntime.jsx(
                  designSystem.Field.Input,
                  {
                    type: "password",
                    autoComplete: "off",
                    placeholder: ps?.isSet ? `Key set (${ps.masked ?? "••••"}) — leave blank to keep` : "No key set",
                    value: keyInput[p] ?? "",
                    onChange: (event) => {
                      const value = event.target.value;
                      setKeyInput((s) => ({ ...s, [p]: value }));
                      setKeyDirty((s) => ({ ...s, [p]: true }));
                    }
                  }
                ),
                /* @__PURE__ */ jsxRuntime.jsx(designSystem.Field.Hint, {})
              ]
            }
          ) })
        ] }, p);
      }),
      /* @__PURE__ */ jsxRuntime.jsx(designSystem.Flex, { children: /* @__PURE__ */ jsxRuntime.jsx(designSystem.Button, { onClick: onSave, loading: saving, disabled: saving, children: formatMessage({ id: index.getTranslation("settings.save"), defaultMessage: "Save" }) }) })
    ] })
  ] }) });
};
const Settings = () => /* @__PURE__ */ jsxRuntime.jsx(admin.Page.Protect, { permissions: index.PERMISSIONS.settingsRead, children: /* @__PURE__ */ jsxRuntime.jsx(SettingsForm, {}) });
exports.Settings = Settings;
