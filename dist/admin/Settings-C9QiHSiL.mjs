import { jsx, jsxs } from "react/jsx-runtime";
import * as React from "react";
import { useIntl } from "react-intl";
import { Page, useFetchClient, useNotification } from "@strapi/strapi/admin";
import { Box, Typography, Flex, Field, SingleSelect, SingleSelectOption, Toggle, Button } from "@strapi/design-system";
import { P as PERMISSIONS, g as getTranslation } from "./index-9REDRZwx.mjs";
const MODELS = {
  anthropic: [
    { id: "claude-opus-5", label: "Claude Opus 5" },
    { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
    { id: "claude-fable-5", label: "Claude Fable 5" },
    { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" }
  ],
  openai: [
    { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
    { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
    { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
    { id: "gpt-5.4", label: "GPT-5.4" }
  ],
  google: [
    // Gemini 3.x — latest generation
    { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
    { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
    { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite" },
    { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite" },
    // Gemini 2.5 — stable workhorses
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" }
  ]
};
const curatedFor$1 = (id) => MODELS[id] != null;
const PROVIDER_CATALOG = [
  { id: "anthropic", label: "Anthropic", requiresBaseUrl: false, hasCuratedModels: curatedFor$1("anthropic") },
  { id: "openai", label: "OpenAI", requiresBaseUrl: false, hasCuratedModels: curatedFor$1("openai") },
  { id: "google", label: "Google", requiresBaseUrl: false, hasCuratedModels: curatedFor$1("google") },
  {
    /**
     * The unbounded tail — any endpoint speaking the OpenAI wire format, reached with no
     * per-provider code (research D3). It ships no curated list by design: the plugin cannot know
     * what a given endpoint serves, so the model identifier is entered directly.
     */
    id: "openai-compatible",
    label: "OpenAI-compatible endpoint",
    requiresBaseUrl: true,
    hasCuratedModels: curatedFor$1("openai-compatible")
  }
];
const getProviderEntry = (id) => PROVIDER_CATALOG.find((p) => p.id === id) ?? null;
const PROVIDER_IDS = PROVIDER_CATALOG.map((p) => p.id);
const emptyByProvider = (value) => PROVIDER_IDS.reduce((acc, p) => {
  acc[p] = value;
  return acc;
}, {});
const curatedFor = (providerId) => MODELS[providerId] ?? null;
const SettingsForm = () => {
  const { formatMessage } = useIntl();
  const { get, put } = useFetchClient();
  const { toggleNotification } = useNotification();
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [server, setServer] = React.useState(null);
  const [activeProvider, setActiveProvider] = React.useState(PROVIDER_IDS[0]);
  const [activeModel, setActiveModel] = React.useState("");
  const [grounding, setGrounding] = React.useState(true);
  const [enabled, setEnabled] = React.useState(emptyByProvider(false));
  const [keyInput, setKeyInput] = React.useState(emptyByProvider(""));
  const [keyDirty, setKeyDirty] = React.useState(emptyByProvider(false));
  const [baseUrl, setBaseUrl] = React.useState(emptyByProvider(""));
  const [inspector, setInspector] = React.useState(null);
  const hydrate = React.useCallback((data) => {
    setServer(data);
    setActiveProvider(data.activeProvider);
    setActiveModel(data.activeModel);
    setGrounding(data.grounding?.enabled !== false);
    setEnabled(
      PROVIDER_IDS.reduce((acc, p) => {
        acc[p] = data.providers[p]?.enabled ?? false;
        return acc;
      }, {})
    );
    setBaseUrl(
      PROVIDER_IDS.reduce((acc, p) => {
        acc[p] = data.providers[p]?.baseUrl ?? "";
        return acc;
      }, {})
    );
    setKeyInput(emptyByProvider(""));
    setKeyDirty(emptyByProvider(false));
  }, []);
  const loadInspector = React.useCallback(async () => {
    try {
      const { data } = await get("/ai-content-studio/settings/grounding");
      setInspector(data);
    } catch {
      setInspector(null);
    }
  }, [get]);
  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data } = await get("/ai-content-studio/settings");
        if (active) {
          hydrate(data);
        }
        await loadInspector();
      } catch {
        toggleNotification({
          type: "danger",
          message: formatMessage({
            id: getTranslation("settings.loadError"),
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
  }, [get, hydrate, loadInspector, toggleNotification, formatMessage]);
  const onSave = async () => {
    setSaving(true);
    try {
      const providers = {};
      for (const p of PROVIDER_IDS) {
        const patch = {};
        if (server && enabled[p] !== server.providers[p]?.enabled) {
          patch.enabled = enabled[p];
        }
        if (keyDirty[p] && keyInput[p].trim() !== "") {
          patch.apiKey = keyInput[p].trim();
        }
        const storedBaseUrl = server?.providers[p]?.baseUrl ?? "";
        if (baseUrl[p].trim() !== storedBaseUrl) {
          patch.baseUrl = baseUrl[p].trim() === "" ? null : baseUrl[p].trim();
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
      if (server && grounding !== (server.grounding?.enabled !== false)) {
        body.grounding = { enabled: grounding };
      }
      if (Object.keys(providers).length > 0) {
        body.providers = providers;
      }
      const { data } = await put("/ai-content-studio/settings", body);
      hydrate(data);
      await loadInspector();
      toggleNotification({
        type: "success",
        message: formatMessage({
          id: getTranslation("settings.saveSuccess"),
          defaultMessage: "AI settings saved."
        })
      });
    } catch (err) {
      const message = err?.response?.data?.error?.message ?? err?.response?.data?.message ?? formatMessage({
        id: getTranslation("settings.saveError"),
        defaultMessage: "Could not save AI settings."
      });
      toggleNotification({ type: "danger", message });
    } finally {
      setSaving(false);
    }
  };
  const curated = curatedFor(activeProvider);
  const modelOptions = curated && activeModel && !curated.some((m) => m.id === activeModel) ? [...curated, { id: activeModel, label: activeModel }] : curated;
  const activeEntry = getProviderEntry(activeProvider);
  const groundingLockedByConfig = inspector?.disabledBy === "config";
  if (loading) {
    return /* @__PURE__ */ jsx(Page.Loading, {});
  }
  return /* @__PURE__ */ jsx(Page.Main, { children: /* @__PURE__ */ jsxs(Box, { padding: 6, children: [
    /* @__PURE__ */ jsx(Typography, { variant: "alpha", tag: "h1", children: formatMessage({
      id: getTranslation("settings.title"),
      defaultMessage: "AI Content Studio — Configuration"
    }) }),
    /* @__PURE__ */ jsx(Box, { paddingTop: 2, children: /* @__PURE__ */ jsx(Typography, { variant: "epsilon", textColor: "neutral600", children: formatMessage({
      id: getTranslation("settings.subtitle"),
      defaultMessage: "Choose the active provider and model, and manage API keys. Keys are encrypted at rest and never shown again."
    }) }) }),
    /* @__PURE__ */ jsxs(Flex, { direction: "column", alignItems: "stretch", gap: 5, marginTop: 6, children: [
      /* @__PURE__ */ jsxs(Field.Root, { name: "activeProvider", children: [
        /* @__PURE__ */ jsx(Field.Label, { children: formatMessage({ id: getTranslation("settings.activeProvider"), defaultMessage: "Active provider" }) }),
        /* @__PURE__ */ jsx(
          SingleSelect,
          {
            value: activeProvider,
            onChange: (value) => {
              const next = String(value);
              setActiveProvider(next);
              const list = curatedFor(next);
              if (!list) {
                setActiveModel("");
              } else if (!list.some((m) => m.id === activeModel)) {
                setActiveModel(list[0]?.id ?? "");
              }
            },
            children: PROVIDER_CATALOG.map((p) => /* @__PURE__ */ jsx(SingleSelectOption, { value: p.id, children: p.label }, p.id))
          }
        )
      ] }),
      /* @__PURE__ */ jsxs(
        Field.Root,
        {
          name: "activeModel",
          hint: modelOptions ? void 0 : "This provider ships no curated model list. Enter the model identifier exactly as the provider documents it — it is saved and sent unchanged.",
          children: [
            /* @__PURE__ */ jsx(Field.Label, { children: formatMessage({ id: getTranslation("settings.activeModel"), defaultMessage: "Active model" }) }),
            modelOptions ? /* @__PURE__ */ jsx(SingleSelect, { value: activeModel, onChange: (value) => setActiveModel(String(value)), children: modelOptions.map((m) => /* @__PURE__ */ jsx(SingleSelectOption, { value: m.id, children: m.label }, m.id)) }) : /* @__PURE__ */ jsx(
              Field.Input,
              {
                autoComplete: "off",
                placeholder: "Model identifier",
                value: activeModel,
                onChange: (event) => setActiveModel(event.target.value)
              }
            ),
            /* @__PURE__ */ jsx(Field.Hint, {})
          ]
        }
      ),
      PROVIDER_CATALOG.map((entry) => {
        const p = entry.id;
        const ps = server?.providers[p];
        return /* @__PURE__ */ jsxs(Box, { padding: 4, hasRadius: true, background: "neutral0", borderColor: "neutral200", children: [
          /* @__PURE__ */ jsxs(Flex, { justifyContent: "space-between", alignItems: "center", children: [
            /* @__PURE__ */ jsx(Typography, { variant: "delta", children: entry.label }),
            /* @__PURE__ */ jsx(
              Toggle,
              {
                name: `${p}-enabled`,
                onLabel: "On",
                offLabel: "Off",
                checked: enabled[p] ?? false,
                onChange: () => setEnabled((s) => ({ ...s, [p]: !s[p] }))
              }
            )
          ] }),
          /* @__PURE__ */ jsx(Box, { marginTop: 3, children: /* @__PURE__ */ jsxs(
            Field.Root,
            {
              name: `${p}-apiKey`,
              hint: ps?.isSet ? "A key is stored. Type a new value only to replace it." : "Write-only — the key is encrypted and never displayed again.",
              children: [
                /* @__PURE__ */ jsx(Field.Label, { children: formatMessage({ id: getTranslation("settings.apiKey"), defaultMessage: "API key" }) }),
                /* @__PURE__ */ jsx(
                  Field.Input,
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
                /* @__PURE__ */ jsx(Field.Hint, {})
              ]
            }
          ) }),
          /* @__PURE__ */ jsx(Box, { marginTop: 3, children: /* @__PURE__ */ jsxs(
            Field.Root,
            {
              name: `${p}-baseUrl`,
              required: entry.requiresBaseUrl,
              hint: entry.requiresBaseUrl ? "Required. The endpoint that serves the OpenAI-compatible API, e.g. https://host/v1 — http:// is accepted for a self-hosted server on your network." : "Optional. Set this only to reach a self-hosted or proxied deployment of this provider.",
              children: [
                /* @__PURE__ */ jsx(Field.Label, { children: "Base URL" }),
                /* @__PURE__ */ jsx(
                  Field.Input,
                  {
                    autoComplete: "off",
                    placeholder: entry.requiresBaseUrl ? "https://host/v1" : "Provider default",
                    value: baseUrl[p] ?? "",
                    onChange: (event) => {
                      const value = event.target.value;
                      setBaseUrl((s) => ({ ...s, [p]: value }));
                    }
                  }
                ),
                /* @__PURE__ */ jsx(Field.Hint, {})
              ]
            }
          ) })
        ] }, p);
      }),
      /* @__PURE__ */ jsxs(Box, { padding: 4, hasRadius: true, background: "neutral0", borderColor: "neutral200", children: [
        /* @__PURE__ */ jsxs(Flex, { justifyContent: "space-between", alignItems: "center", children: [
          /* @__PURE__ */ jsx(Typography, { variant: "delta", children: "Project structure in the prompt" }),
          /* @__PURE__ */ jsx(
            Toggle,
            {
              name: "grounding-enabled",
              onLabel: "On",
              offLabel: "Off",
              checked: grounding && !groundingLockedByConfig,
              disabled: groundingLockedByConfig,
              onChange: () => setGrounding((v) => !v)
            }
          )
        ] }),
        /* @__PURE__ */ jsx(Box, { paddingTop: 2, children: /* @__PURE__ */ jsx(Typography, { variant: "pi", textColor: "neutral600", children: groundingLockedByConfig ? "Turned off for this deployment by the grounding.enabled plugin config key. Change it in the host application’s config/plugins.ts to re-enable this control." : "Embeds a generated description of this project’s content types, fields, components and preview targets in the assistant’s instructions, so it stops guessing at field names. It is deterministic, size-bounded and filtered to what your account can read — and it AUTHORIZES NOTHING: every read and every change is still checked against your own permissions." }) }),
        inspector ? /* @__PURE__ */ jsxs(Box, { marginTop: 3, children: [
          /* @__PURE__ */ jsx(Typography, { variant: "pi", fontWeight: "bold", textColor: "neutral700", children: inspector.enabled && inspector.text ? `Currently sent — ${inspector.charCount.toLocaleString()} of ${inspector.maxChars.toLocaleString()} characters, tier "${inspector.tier}"${inspector.partial ? " (shortened to fit)" : ""}, ${inspector.contentTypeCount} content type${inspector.contentTypeCount === 1 ? "" : "s"}${inspector.omittedContentTypeCount > 0 ? `, ${inspector.omittedContentTypeCount} omitted` : ""}` : "Requests are currently carrying no project description." }),
          inspector.enabled && inspector.text ? /* @__PURE__ */ jsx(
            Box,
            {
              marginTop: 2,
              padding: 3,
              hasRadius: true,
              background: "neutral100",
              borderColor: "neutral200",
              style: { maxHeight: "22rem", overflow: "auto" },
              children: /* @__PURE__ */ jsx(
                "pre",
                {
                  style: {
                    margin: 0,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontSize: "1.15rem",
                    lineHeight: 1.45
                  },
                  children: inspector.text
                }
              )
            }
          ) : null
        ] }) : null
      ] }),
      activeEntry?.requiresBaseUrl ? /* @__PURE__ */ jsx(Typography, { variant: "pi", textColor: "neutral600", children: "The active provider requires a Base URL. Without a valid one, requests are refused before generation begins rather than failing mid-reply." }) : null,
      /* @__PURE__ */ jsx(Flex, { children: /* @__PURE__ */ jsx(Button, { onClick: onSave, loading: saving, disabled: saving, children: formatMessage({ id: getTranslation("settings.save"), defaultMessage: "Save" }) }) })
    ] })
  ] }) });
};
const Settings = () => /* @__PURE__ */ jsx(Page.Protect, { permissions: PERMISSIONS.settingsRead, children: /* @__PURE__ */ jsx(SettingsForm, {}) });
export {
  Settings
};
