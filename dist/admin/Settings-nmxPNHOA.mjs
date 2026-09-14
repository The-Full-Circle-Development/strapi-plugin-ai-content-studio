import { jsx, jsxs } from "react/jsx-runtime";
import * as React from "react";
import { useIntl } from "react-intl";
import { Page, useFetchClient, useNotification } from "@strapi/strapi/admin";
import { Box, Typography, Flex, Field, SingleSelect, SingleSelectOption, Toggle, Button } from "@strapi/design-system";
import { P as PERMISSIONS, g as getTranslation } from "./index-55TYa2a4.mjs";
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
const PAGE_READING_REASONS = {
  not_configured: "no preview target is configured for it",
  origin_mismatch: "its resolved URL left the configured front-end origin",
  unreachable: "the page could not be reached",
  timeout: "the request timed out",
  too_large: "the page exceeded the size limit",
  not_html: "the response was not HTML",
  no_readable_text: "the page carried no readable text — it is assembled in the browser"
};
const DEPTH_SAMPLE = { light: 5, standard: 15, deep: 50 };
const DEPTH_LABEL = {
  light: "Light — 5 entries per content type",
  standard: "Standard — 15 entries per content type",
  deep: "Deep — 50 entries per content type"
};
const SOURCE_LABEL = {
  schema: "Schema only — the generated structure description",
  brief: "Brief only — the content briefing",
  both: "Both — structure, then the briefing"
};
const PROVIDER_IDS = PROVIDER_CATALOG.map((p) => p.id);
const emptyByProvider = (value) => PROVIDER_IDS.reduce((acc, p) => {
  acc[p] = value;
  return acc;
}, {});
const curatedFor = (providerId) => MODELS[providerId] ?? null;
const SettingsForm = () => {
  const { formatMessage } = useIntl();
  const { get, put, post } = useFetchClient();
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
  const [briefSource, setBriefSource] = React.useState("schema");
  const [briefDepth, setBriefDepth] = React.useState("deep");
  const [brief, setBrief] = React.useState(null);
  const [briefBusy, setBriefBusy] = React.useState(false);
  const [runIntent, setRunIntent] = React.useState(false);
  const hydrate = React.useCallback((data) => {
    setServer(data);
    setActiveProvider(data.activeProvider);
    setActiveModel(data.activeModel);
    setGrounding(data.grounding?.enabled !== false);
    setBriefSource(data.contentBrief?.source ?? "schema");
    setBriefDepth(data.contentBrief?.depth ?? "deep");
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
  const loadBrief = React.useCallback(async () => {
    try {
      const { data } = await get("/ai-content-studio/content-brief");
      setBrief(data);
      return data;
    } catch {
      setBrief(null);
      return null;
    }
  }, [get]);
  React.useEffect(() => {
    if (!brief?.run.active) {
      return void 0;
    }
    const id = window.setInterval(() => {
      void loadBrief();
    }, 3e3);
    return () => window.clearInterval(id);
  }, [brief?.run.active, loadBrief]);
  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data } = await get("/ai-content-studio/settings");
        if (active) {
          hydrate(data);
        }
        await loadInspector();
        await loadBrief();
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
  }, [get, hydrate, loadInspector, loadBrief, toggleNotification, formatMessage]);
  const onRunBrief = async () => {
    setRunIntent(false);
    setBriefBusy(true);
    try {
      const { data } = await post("/ai-content-studio/content-brief/run", { depth: briefDepth });
      const started = data;
      toggleNotification({
        type: "info",
        message: `Brief run started over ${started.contentTypes} content type${started.contentTypes === 1 ? "" : "s"}. You can leave this page — it continues in the background.`
      });
      await loadBrief();
    } catch (err) {
      const message = err?.response?.data?.error?.message ?? "Could not start the brief run.";
      toggleNotification({ type: "danger", message });
    } finally {
      setBriefBusy(false);
    }
  };
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
      if (server && (briefSource !== server.contentBrief?.source || briefDepth !== server.contentBrief?.depth)) {
        body.contentBrief = { source: briefSource, depth: briefDepth };
      }
      if (Object.keys(providers).length > 0) {
        body.providers = providers;
      }
      const { data } = await put("/ai-content-studio/settings", body);
      hydrate(data);
      await loadInspector();
      await loadBrief();
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
      /* @__PURE__ */ jsxs(Box, { padding: 4, hasRadius: true, background: "neutral0", borderColor: "neutral200", children: [
        /* @__PURE__ */ jsx(Typography, { variant: "delta", children: "Content briefing" }),
        /* @__PURE__ */ jsx(Box, { paddingTop: 2, children: /* @__PURE__ */ jsx(Typography, { variant: "pi", textColor: "neutral600", children: "A one-off run that reads a sample of this project’s real entries and writes a short, human-readable briefing: one paragraph on what this project is, then one per content type on what it is for and how it is actually used." }) }),
        /* @__PURE__ */ jsx(Box, { marginTop: 3, children: /* @__PURE__ */ jsxs(
          Field.Root,
          {
            name: "brief-source",
            hint: !grounding || groundingLockedByConfig ? "Turn the structure switch above on to use either source — it is the one control for putting generated context in the prompt at all." : briefSource === "brief" ? "The briefing replaces the structure description. The assistant keeps exact field names through its read tools, but loses the dotted media-slot paths the description lists up front." : briefSource === "both" ? "Structure first, briefing second. Each has its own character budget, so together they cannot crowd out the conversation." : "The current behaviour: schema-derived structure only. No content is read.",
            children: [
              /* @__PURE__ */ jsx(Field.Label, { children: "What the assistant’s instructions carry" }),
              /* @__PURE__ */ jsx(
                SingleSelect,
                {
                  value: briefSource,
                  onChange: (value) => setBriefSource(String(value)),
                  disabled: !grounding || groundingLockedByConfig,
                  children: Object.keys(SOURCE_LABEL).map((id) => /* @__PURE__ */ jsx(SingleSelectOption, { value: id, children: SOURCE_LABEL[id] }, id))
                }
              ),
              /* @__PURE__ */ jsx(Field.Hint, {})
            ]
          }
        ) }),
        /* @__PURE__ */ jsx(Box, { marginTop: 3, children: /* @__PURE__ */ jsxs(
          Field.Root,
          {
            name: "brief-depth",
            hint: "Entries are sampled from both ends of the update order, so the briefing reflects what the project has settled into as well as what it is doing now.",
            children: [
              /* @__PURE__ */ jsx(Field.Label, { children: "How much content one run reads" }),
              /* @__PURE__ */ jsx(
                SingleSelect,
                {
                  value: briefDepth,
                  onChange: (value) => setBriefDepth(String(value)),
                  children: Object.keys(DEPTH_LABEL).map((id) => /* @__PURE__ */ jsx(SingleSelectOption, { value: id, children: DEPTH_LABEL[id] }, id))
                }
              ),
              /* @__PURE__ */ jsx(Field.Hint, {})
            ]
          }
        ) }),
        brief ? /* @__PURE__ */ jsxs(Box, { marginTop: 3, padding: 3, hasRadius: true, background: "neutral100", borderColor: "neutral200", children: [
          /* @__PURE__ */ jsx(Typography, { variant: "pi", fontWeight: "bold", textColor: "neutral700", children: "What a full run costs" }),
          /* @__PURE__ */ jsx(Box, { paddingTop: 1, children: /* @__PURE__ */ jsxs(Typography, { variant: "pi", textColor: "neutral600", children: [
            brief.readableCount,
            " content type",
            brief.readableCount === 1 ? "" : "s",
            " ×",
            " ",
            DEPTH_SAMPLE[briefDepth],
            " entries read =",
            " ",
            /* @__PURE__ */ jsxs("strong", { children: [
              brief.estimate.modelCalls,
              " model call",
              brief.estimate.modelCalls === 1 ? "" : "s"
            ] }),
            " ",
            "billed to your active provider — one per content type",
            brief.scopeToReader ? "" : ", plus one for the project overview",
            " — run sequentially. Expect roughly",
            " ",
            Math.max(1, Math.round(brief.estimate.modelCalls * 4 / 60)),
            "–",
            Math.max(1, Math.round(brief.estimate.modelCalls * 12 / 60)),
            " minute",
            brief.estimate.modelCalls > 15 ? "s" : "",
            ". Re-running replaces every section."
          ] }) }),
          /* @__PURE__ */ jsx(Box, { paddingTop: 2, children: /* @__PURE__ */ jsx(Typography, { variant: "pi", textColor: "neutral600", children: brief.scopeToReader ? "Every account is served only the sections its own permissions allow, and the project overview is withheld. Set contentBrief.scopeToReader to false in the host application’s config/plugins.ts for one shared briefing." : "One briefing, identical for every account that can use the chat — overview included — regardless of their own content permissions. It never describes a content type you cannot read yourself, and it changes nothing about what the assistant may do: every read and every change is still checked against the acting account. Set contentBrief.scopeToReader to true in the host application’s config/plugins.ts to serve each reader only their own sections instead." }) }),
          brief.estimate.pageReading?.enabled ? /* @__PURE__ */ jsx(Box, { paddingTop: 2, children: /* @__PURE__ */ jsxs(Typography, { variant: "pi", textColor: "neutral600", children: [
            "Rendered-page grounding is ",
            /* @__PURE__ */ jsx("strong", { children: "on" }),
            ".",
            " ",
            brief.estimate.pageReading.withPreviewTarget,
            " content type",
            brief.estimate.pageReading.withPreviewTarget === 1 ? " has" : "s have",
            " a preview target configured, so the run additionally makes",
            " ",
            /* @__PURE__ */ jsxs("strong", { children: [
              brief.estimate.pageReading.withPreviewTarget,
              " HTTP fetch",
              brief.estimate.pageReading.withPreviewTarget === 1 ? "" : "es"
            ] }),
            " ",
            "of your own front end — each bounded to",
            " ",
            Math.round(brief.estimate.pageReading.timeoutMs / 1e3),
            " second",
            brief.estimate.pageReading.timeoutMs === 1e3 ? "" : "s",
            " and",
            " ",
            Math.round(brief.estimate.pageReading.maxBytes / 1e3),
            " kB, same-origin only, with no cookies and no credentials. Each fetch feeds the",
            " ",
            /* @__PURE__ */ jsx("strong", { children: "same single model call" }),
            " for that content type rather than adding one, so the number of billed calls above is unchanged. Nothing fetched is stored: only the model’s prose reaches a section. Content types with no preview target are described from their entries exactly as before."
          ] }) }) : null,
          brief.pageReadingFailures && brief.pageReadingFailures.length > 0 ? /* @__PURE__ */ jsx(Box, { paddingTop: 2, children: /* @__PURE__ */ jsxs(Typography, { variant: "pi", textColor: "neutral600", children: [
            "On the last run, ",
            brief.pageReadingFailures.length,
            " content type",
            brief.pageReadingFailures.length === 1 ? "" : "s",
            " fell back to an entry-only section:",
            " ",
            brief.pageReadingFailures.map(
              (failure) => `${failure.uid} (${PAGE_READING_REASONS[failure.reason] ?? failure.reason})`
            ).join("; "),
            "."
          ] }) }) : null,
          brief.autoRefresh ? /* @__PURE__ */ jsx(Box, { paddingTop: 2, children: /* @__PURE__ */ jsxs(Typography, { variant: "pi", textColor: "neutral600", children: [
            "After the first run, sections whose content or schema changed are refreshed automatically during chat sessions — at most",
            " ",
            brief.maxAutoRefreshSections,
            " content type",
            brief.maxAutoRefreshSections === 1 ? "" : "s",
            " per pass and no more than once every ",
            brief.refreshThrottleMinutes,
            " minutes. That is the only way this feature spends anything without a click; set contentBrief.autoRefresh to false in the host application’s config/plugins.ts to disable it."
          ] }) }) : null
        ] }) : null,
        brief ? /* @__PURE__ */ jsxs(Box, { marginTop: 3, children: [
          /* @__PURE__ */ jsx(Typography, { variant: "pi", fontWeight: "bold", textColor: "neutral700", children: brief.run.active ? `Running — ${brief.run.doneCount} of ${brief.run.totalCount} done${brief.run.currentUid ? `, on ${brief.run.currentUid}` : ""}` : brief.run.state === "never-run" ? "No briefing has been generated yet." : `${brief.sectionCount} content type${brief.sectionCount === 1 ? "" : "s"} described${brief.run.completedAt ? `, last run ${new Date(brief.run.completedAt).toLocaleString()}` : ""}${brief.staleCount > 0 ? `, ${brief.staleCount} out of date` : ""}${brief.missingCount > 0 ? `, ${brief.missingCount} never described` : ""}` }),
          brief.run.error ? /* @__PURE__ */ jsx(Box, { paddingTop: 1, children: /* @__PURE__ */ jsx(Typography, { variant: "pi", textColor: "danger600", children: brief.run.error }) }) : null
        ] }) : null,
        runIntent ? /* @__PURE__ */ jsxs(
          Box,
          {
            marginTop: 3,
            padding: 3,
            hasRadius: true,
            background: "danger100",
            borderColor: "danger200",
            children: [
              /* @__PURE__ */ jsxs(Typography, { variant: "pi", fontWeight: "bold", textColor: "danger700", children: [
                "Start a run of ",
                brief?.estimate.modelCalls ?? 0,
                " model call",
                (brief?.estimate.modelCalls ?? 0) === 1 ? "" : "s",
                "?"
              ] }),
              /* @__PURE__ */ jsx(Box, { paddingTop: 1, children: /* @__PURE__ */ jsx(Typography, { variant: "pi", textColor: "danger700", children: "This bills your active provider and replaces every existing section. It cannot be cancelled once started." }) }),
              /* @__PURE__ */ jsxs(Flex, { gap: 2, paddingTop: 2, children: [
                /* @__PURE__ */ jsx(Button, { variant: "danger", onClick: () => void onRunBrief(), loading: briefBusy, children: "Yes, run it" }),
                /* @__PURE__ */ jsx(Button, { variant: "tertiary", onClick: () => setRunIntent(false), disabled: briefBusy, children: "Cancel" })
              ] })
            ]
          }
        ) : null,
        /* @__PURE__ */ jsxs(Flex, { gap: 2, marginTop: 3, children: [
          /* @__PURE__ */ jsx(
            Button,
            {
              variant: "secondary",
              onClick: () => setRunIntent(true),
              disabled: briefBusy || runIntent || Boolean(brief?.run.active) || brief?.enabled === false,
              children: brief?.run.state === "never-run" ? "Generate briefing" : "Re-run briefing"
            }
          ),
          brief?.run.active ? /* @__PURE__ */ jsx(Typography, { variant: "pi", textColor: "neutral600", children: "Running in the background — you can leave this page." }) : null
        ] }),
        brief?.enabled === false ? /* @__PURE__ */ jsx(Box, { paddingTop: 2, children: /* @__PURE__ */ jsx(Typography, { variant: "pi", textColor: "neutral600", children: "Turned off for this deployment by the contentBrief.enabled plugin config key. Change it in the host application’s config/plugins.ts to re-enable this control." }) }) : null,
        brief && (brief.sections.length > 0 || brief.overview) ? /* @__PURE__ */ jsxs(
          Box,
          {
            marginTop: 3,
            padding: 3,
            hasRadius: true,
            background: "neutral100",
            borderColor: "neutral200",
            style: { maxHeight: "22rem", overflow: "auto" },
            children: [
              brief.overview ? /* @__PURE__ */ jsxs(Box, { paddingBottom: 3, children: [
                /* @__PURE__ */ jsx(Typography, { variant: "pi", fontWeight: "bold", textColor: "neutral700", children: "What this project is" }),
                /* @__PURE__ */ jsx(Box, { paddingTop: 1, children: /* @__PURE__ */ jsx(Typography, { variant: "pi", textColor: "neutral700", children: brief.overview }) })
              ] }) : null,
              brief.sections.map((section) => /* @__PURE__ */ jsxs(Box, { paddingBottom: 3, children: [
                /* @__PURE__ */ jsxs(Typography, { variant: "pi", fontWeight: "bold", textColor: "neutral700", children: [
                  section.uid,
                  section.stale ? " — out of date" : ""
                ] }),
                /* @__PURE__ */ jsx(Box, { paddingTop: 1, children: /* @__PURE__ */ jsx(Typography, { variant: "pi", textColor: "neutral700", children: section.text }) }),
                /* @__PURE__ */ jsx(Box, { paddingTop: 1, children: /* @__PURE__ */ jsxs(Typography, { variant: "pi", textColor: "neutral500", children: [
                  section.sampledCount,
                  " of ",
                  section.totalCount,
                  " entries read ·",
                  " ",
                  new Date(section.generatedAt).toLocaleDateString()
                ] }) })
              ] }, section.uid))
            ]
          }
        ) : null
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
