import * as React from 'react';
import { useIntl } from 'react-intl';
import { Page, useFetchClient, useNotification } from '@strapi/strapi/admin';
import {
  Box,
  Flex,
  Typography,
  Button,
  Toggle,
  SingleSelect,
  SingleSelectOption,
  Field,
} from '@strapi/design-system';
import { PERMISSIONS } from '../permissions';
import { MODELS } from '../data/models';
import { PROVIDER_CATALOG, getProviderEntry } from '../data/providers';
import { getTranslation } from '../utils/getTranslation';

/**
 * The configuration screen.
 *
 * Provider options come from `data/providers.ts` — a SEPARATE module from `data/models.ts`, which
 * keeps only the curated model lists and whose formatting is parsed as text by a session hook
 * (research D15). Nothing is appended to that file.
 */

interface MaskedProviderState {
  isSet: boolean;
  enabled: boolean;
  masked: string | null;
  /** Returned in FULL — it is configuration, not a secret (FR-008). */
  baseUrl: string | null;
}

type GroundingSource = 'schema' | 'brief' | 'both';
type BriefDepth = 'light' | 'standard' | 'deep';

interface SettingsResponse {
  activeProvider: string;
  activeModel: string;
  providers: Record<string, MaskedProviderState>;
  grounding: { enabled: boolean };
  contentBrief: { source: GroundingSource; depth: BriefDepth };
}

interface BriefStatusResponse {
  enabled: boolean;
  /** false = one brief, identical for every account (the default). */
  scopeToReader: boolean;
  overview: string | null;
  autoRefresh: boolean;
  refreshThrottleMinutes: number;
  maxAutoRefreshSections: number;
  maxChars: number;
  run: {
    state: 'never-run' | 'running' | 'ready' | 'failed';
    depth: BriefDepth;
    startedAt: string | null;
    completedAt: string | null;
    currentUid: string | null;
    doneCount: number;
    totalCount: number;
    error: string | null;
    active: boolean;
  };
  sectionCount: number;
  readableCount: number;
  staleCount: number;
  missingCount: number;
  estimate: {
    contentTypes: number;
    entriesPerType: number;
    modelCalls: number;
    /** Rendered-page grounding (005 FR-024, SC-011). `modelCalls` above is UNCHANGED by it. */
    pageReading?: {
      enabled: boolean;
      withPreviewTarget: number;
      timeoutMs: number;
      maxBytes: number;
    };
  };
  /** Which content types fell back to an entry-only section on the last run, and why (SC-012). */
  pageReadingFailures?: Array<{ uid: string; reason: string }>;
  sections: Array<{
    uid: string;
    text: string;
    sampledCount: number;
    totalCount: number;
    generatedAt: string;
    stale: boolean;
    locale?: string | null;
    pageInformed?: boolean;
    pageUrl?: string | null;
  }>;
}

/** Plain-language reasons for a page-reading fallback, so the panel names a cause, not a code. */
const PAGE_READING_REASONS: Record<string, string> = {
  not_configured: 'no preview target is configured for it',
  origin_mismatch: 'its resolved URL left the configured front-end origin',
  unreachable: 'the page could not be reached',
  timeout: 'the request timed out',
  too_large: 'the page exceeded the size limit',
  not_html: 'the response was not HTML',
  no_readable_text: 'the page carried no readable text — it is assembled in the browser',
};

/** Entries read per content type, per depth. Mirrors `BRIEF_DEPTH_SAMPLE` on the server. */
const DEPTH_SAMPLE: Record<BriefDepth, number> = { light: 5, standard: 15, deep: 50 };

const DEPTH_LABEL: Record<BriefDepth, string> = {
  light: 'Light — 5 entries per content type',
  standard: 'Standard — 15 entries per content type',
  deep: 'Deep — 50 entries per content type',
};

const SOURCE_LABEL: Record<GroundingSource, string> = {
  schema: 'Schema only — the generated structure description',
  brief: 'Brief only — the content briefing',
  both: 'Both — structure, then the briefing',
};

interface GroundingResponse {
  enabled: boolean;
  disabledBy: 'config' | 'settings' | null;
  text: string | null;
  tier: string | null;
  partial: boolean;
  charCount: number;
  maxChars: number;
  contentTypeCount: number;
  omittedContentTypeCount: number;
}

const PROVIDER_IDS = PROVIDER_CATALOG.map((p) => p.id);

const emptyByProvider = <T,>(value: T): Record<string, T> =>
  PROVIDER_IDS.reduce<Record<string, T>>((acc, p) => {
    acc[p] = value;
    return acc;
  }, {});

/** The curated list for a provider, or null when it ships none (FR-004). */
const curatedFor = (providerId: string): Array<{ id: string; label: string }> | null =>
  (MODELS as Record<string, Array<{ id: string; label: string }> | undefined>)[providerId] ?? null;

const SettingsForm = () => {
  const { formatMessage } = useIntl();
  const { get, put, post } = useFetchClient();
  const { toggleNotification } = useNotification();

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [server, setServer] = React.useState<SettingsResponse | null>(null);

  const [activeProvider, setActiveProvider] = React.useState<string>(PROVIDER_IDS[0]);
  const [activeModel, setActiveModel] = React.useState<string>('');
  const [grounding, setGrounding] = React.useState(true);
  const [enabled, setEnabled] = React.useState<Record<string, boolean>>(emptyByProvider(false));
  const [keyInput, setKeyInput] = React.useState<Record<string, string>>(emptyByProvider(''));
  const [keyDirty, setKeyDirty] = React.useState<Record<string, boolean>>(emptyByProvider(false));
  const [baseUrl, setBaseUrl] = React.useState<Record<string, string>>(emptyByProvider(''));
  const [inspector, setInspector] = React.useState<GroundingResponse | null>(null);

  const [briefSource, setBriefSource] = React.useState<GroundingSource>('schema');
  const [briefDepth, setBriefDepth] = React.useState<BriefDepth>('deep');
  const [brief, setBrief] = React.useState<BriefStatusResponse | null>(null);
  const [briefBusy, setBriefBusy] = React.useState(false);
  /** Armed by the Run button; the run itself only starts on the confirmation (cost is real money). */
  const [runIntent, setRunIntent] = React.useState(false);

  const hydrate = React.useCallback((data: SettingsResponse) => {
    setServer(data);
    setActiveProvider(data.activeProvider);
    setActiveModel(data.activeModel);
    setGrounding(data.grounding?.enabled !== false);
    setBriefSource(data.contentBrief?.source ?? 'schema');
    setBriefDepth(data.contentBrief?.depth ?? 'deep');
    setEnabled(
      PROVIDER_IDS.reduce<Record<string, boolean>>((acc, p) => {
        acc[p] = data.providers[p]?.enabled ?? false;
        return acc;
      }, {})
    );
    setBaseUrl(
      PROVIDER_IDS.reduce<Record<string, string>>((acc, p) => {
        acc[p] = data.providers[p]?.baseUrl ?? '';
        return acc;
      }, {})
    );
    setKeyInput(emptyByProvider(''));
    setKeyDirty(emptyByProvider(false));
  }, []);

  /** The inspector shows the EXACT text requests are carrying for THIS account (FR-035). */
  const loadInspector = React.useCallback(async () => {
    try {
      const { data } = await get('/ai-content-studio/settings/grounding');
      setInspector(data as GroundingResponse);
    } catch {
      // The inspector is diagnostic: if it cannot load, the rest of the screen still works.
      setInspector(null);
    }
  }, [get]);

  const loadBrief = React.useCallback(async () => {
    try {
      const { data } = await get('/ai-content-studio/content-brief');
      setBrief(data as BriefStatusResponse);
      return data as BriefStatusResponse;
    } catch {
      // Diagnostic, like the inspector: a failure here must not take the rest of the screen down.
      setBrief(null);
      return null;
    }
  }, [get]);

  /**
   * While a run is in progress the status is polled, because the run is a BACKGROUND task the
   * request that started it never waited for. Polling stops the moment the run is no longer active,
   * so an idle settings page makes no repeating request.
   */
  React.useEffect(() => {
    if (!brief?.run.active) {
      return undefined;
    }
    const id = window.setInterval(() => {
      void loadBrief();
    }, 3000);
    return () => window.clearInterval(id);
  }, [brief?.run.active, loadBrief]);

  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data } = await get('/ai-content-studio/settings');
        if (active) {
          hydrate(data as SettingsResponse);
        }
        await loadInspector();
        await loadBrief();
      } catch {
        toggleNotification({
          type: 'danger',
          message: formatMessage({
            id: getTranslation('settings.loadError'),
            defaultMessage: 'Failed to load AI settings.',
          }),
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

  /** Start a run. Reached only from the confirmation, never from the button itself. */
  const onRunBrief = async () => {
    setRunIntent(false);
    setBriefBusy(true);
    try {
      // The depth is sent explicitly so an operator can run at a depth they have not saved yet —
      // the selector is the intent for THIS run, not only a stored preference.
      const { data } = await post('/ai-content-studio/content-brief/run', { depth: briefDepth });
      const started = data as { contentTypes: number };
      toggleNotification({
        type: 'info',
        message: `Brief run started over ${started.contentTypes} content type${
          started.contentTypes === 1 ? '' : 's'
        }. You can leave this page — it continues in the background.`,
      });
      await loadBrief();
    } catch (err) {
      const message =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message ?? 'Could not start the brief run.';
      toggleNotification({ type: 'danger', message });
    } finally {
      setBriefBusy(false);
    }
  };

  const onSave = async () => {
    setSaving(true);
    try {
      const providers: Record<
        string,
        { enabled?: boolean; apiKey?: string; baseUrl?: string | null }
      > = {};
      for (const p of PROVIDER_IDS) {
        const patch: { enabled?: boolean; apiKey?: string; baseUrl?: string | null } = {};
        if (server && enabled[p] !== server.providers[p]?.enabled) {
          patch.enabled = enabled[p];
        }
        if (keyDirty[p] && keyInput[p].trim() !== '') {
          patch.apiKey = keyInput[p].trim();
        }
        const storedBaseUrl = server?.providers[p]?.baseUrl ?? '';
        if (baseUrl[p].trim() !== storedBaseUrl) {
          // A cleared field sends null, which the server treats as "clear it".
          patch.baseUrl = baseUrl[p].trim() === '' ? null : baseUrl[p].trim();
        }
        if (Object.keys(patch).length > 0) {
          providers[p] = patch;
        }
      }

      const body: Record<string, unknown> = {};
      if (server && activeProvider !== server.activeProvider) {
        body.activeProvider = activeProvider;
      }
      if (server && activeModel !== server.activeModel) {
        body.activeModel = activeModel;
      }
      if (server && grounding !== (server.grounding?.enabled !== false)) {
        body.grounding = { enabled: grounding };
      }
      if (
        server &&
        (briefSource !== server.contentBrief?.source || briefDepth !== server.contentBrief?.depth)
      ) {
        body.contentBrief = { source: briefSource, depth: briefDepth };
      }
      if (Object.keys(providers).length > 0) {
        body.providers = providers;
      }

      const { data } = await put('/ai-content-studio/settings', body);
      hydrate(data as SettingsResponse);
      await loadInspector();
      await loadBrief();
      toggleNotification({
        type: 'success',
        message: formatMessage({
          id: getTranslation('settings.saveSuccess'),
          defaultMessage: 'AI settings saved.',
        }),
      });
    } catch (err) {
      // The server's message is already actionable and credential-free — surface it rather than a
      // generic one, so an invalid Base URL says which field is wrong.
      const message =
        (err as { response?: { data?: { error?: { message?: string }; message?: string } } })?.response
          ?.data?.error?.message ??
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        formatMessage({
          id: getTranslation('settings.saveError'),
          defaultMessage: 'Could not save AI settings.',
        });
      toggleNotification({ type: 'danger', message });
    } finally {
      setSaving(false);
    }
  };

  /**
   * The options rendered in the model select, for a provider that HAS a curated list.
   *
   * An install upgraded from an older version may hold an `activeModel` that is still perfectly
   * valid at the provider but no longer curated here. We must neither change it nor render a select
   * whose value matches no option — so a synthetic entry is appended for it, labelled with the raw
   * identifier because there is no display name for a model we do not curate. It is presentational
   * only: never added to MODELS, never persisted, and never written back to the store on load.
   */
  const curated = curatedFor(activeProvider);
  const modelOptions =
    curated && activeModel && !curated.some((m) => m.id === activeModel)
      ? [...curated, { id: activeModel, label: activeModel }]
      : curated;

  const activeEntry = getProviderEntry(activeProvider);
  const groundingLockedByConfig = inspector?.disabledBy === 'config';

  if (loading) {
    return <Page.Loading />;
  }

  return (
    <Page.Main>
      <Box padding={6}>
        <Typography variant="alpha" tag="h1">
          {formatMessage({
            id: getTranslation('settings.title'),
            defaultMessage: 'AI Content Studio — Configuration',
          })}
        </Typography>
        <Box paddingTop={2}>
          <Typography variant="epsilon" textColor="neutral600">
            {formatMessage({
              id: getTranslation('settings.subtitle'),
              defaultMessage:
                'Choose the active provider and model, and manage API keys. Keys are encrypted at rest and never shown again.',
            })}
          </Typography>
        </Box>

        <Flex direction="column" alignItems="stretch" gap={5} marginTop={6}>
          <Field.Root name="activeProvider">
            <Field.Label>
              {formatMessage({ id: getTranslation('settings.activeProvider'), defaultMessage: 'Active provider' })}
            </Field.Label>
            <SingleSelect
              value={activeProvider}
              onChange={(value: string | number) => {
                const next = String(value);
                setActiveProvider(next);
                /*
                 * The unguarded `MODELS[next][0].id` index is GONE. It threw for any provider that
                 * ships no curated list, which is exactly what the compatible-endpoint provider
                 * does by design. Now: keep the saved identifier if the new provider curates it,
                 * otherwise fall back to that provider's first curated entry, and if it curates
                 * nothing at all, clear the field so the free-text input starts empty.
                 */
                const list = curatedFor(next);
                if (!list) {
                  setActiveModel('');
                } else if (!list.some((m) => m.id === activeModel)) {
                  setActiveModel(list[0]?.id ?? '');
                }
              }}
            >
              {PROVIDER_CATALOG.map((p) => (
                <SingleSelectOption key={p.id} value={p.id}>
                  {p.label}
                </SingleSelectOption>
              ))}
            </SingleSelect>
          </Field.Root>

          {/*
            A curated select when the provider ships a list; a plain text input when it does not
            (FR-004). A directly entered identifier is stored VERBATIM and survives a save/reload
            round trip unchanged (FR-005).
          */}
          <Field.Root
            name="activeModel"
            hint={
              modelOptions
                ? undefined
                : 'This provider ships no curated model list. Enter the model identifier exactly as the provider documents it — it is saved and sent unchanged.'
            }
          >
            <Field.Label>
              {formatMessage({ id: getTranslation('settings.activeModel'), defaultMessage: 'Active model' })}
            </Field.Label>
            {modelOptions ? (
              <SingleSelect value={activeModel} onChange={(value: string | number) => setActiveModel(String(value))}>
                {modelOptions.map((m) => (
                  <SingleSelectOption key={m.id} value={m.id}>
                    {m.label}
                  </SingleSelectOption>
                ))}
              </SingleSelect>
            ) : (
              <Field.Input
                autoComplete="off"
                placeholder="Model identifier"
                value={activeModel}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                  setActiveModel(event.target.value)
                }
              />
            )}
            <Field.Hint />
          </Field.Root>

          {PROVIDER_CATALOG.map((entry) => {
            const p = entry.id;
            const ps = server?.providers[p];
            return (
              <Box key={p} padding={4} hasRadius background="neutral0" borderColor="neutral200">
                <Flex justifyContent="space-between" alignItems="center">
                  <Typography variant="delta">{entry.label}</Typography>
                  <Toggle
                    name={`${p}-enabled`}
                    onLabel="On"
                    offLabel="Off"
                    checked={enabled[p] ?? false}
                    onChange={() => setEnabled((s) => ({ ...s, [p]: !s[p] }))}
                  />
                </Flex>
                <Box marginTop={3}>
                  <Field.Root
                    name={`${p}-apiKey`}
                    hint={
                      ps?.isSet
                        ? 'A key is stored. Type a new value only to replace it.'
                        : 'Write-only — the key is encrypted and never displayed again.'
                    }
                  >
                    <Field.Label>
                      {formatMessage({ id: getTranslation('settings.apiKey'), defaultMessage: 'API key' })}
                    </Field.Label>
                    <Field.Input
                      type="password"
                      autoComplete="off"
                      placeholder={
                        ps?.isSet
                          ? `Key set (${ps.masked ?? '••••'}) — leave blank to keep`
                          : 'No key set'
                      }
                      value={keyInput[p] ?? ''}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                        const value = event.target.value;
                        setKeyInput((s) => ({ ...s, [p]: value }));
                        setKeyDirty((s) => ({ ...s, [p]: true }));
                      }}
                    />
                    <Field.Hint />
                  </Field.Root>
                </Box>

                {/*
                  Base URL is its OWN labelled field, visibly separate from the credential — never a
                  placeholder or a hint on the key field (FR-008). That separation is the point: an
                  endpoint can be shown, checked and corrected without ever risking the key.
                */}
                <Box marginTop={3}>
                  <Field.Root
                    name={`${p}-baseUrl`}
                    required={entry.requiresBaseUrl}
                    hint={
                      entry.requiresBaseUrl
                        ? 'Required. The endpoint that serves the OpenAI-compatible API, e.g. https://host/v1 — http:// is accepted for a self-hosted server on your network.'
                        : 'Optional. Set this only to reach a self-hosted or proxied deployment of this provider.'
                    }
                  >
                    <Field.Label>Base URL</Field.Label>
                    <Field.Input
                      autoComplete="off"
                      placeholder={entry.requiresBaseUrl ? 'https://host/v1' : 'Provider default'}
                      value={baseUrl[p] ?? ''}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                        const value = event.target.value;
                        setBaseUrl((s) => ({ ...s, [p]: value }));
                      }}
                    />
                    <Field.Hint />
                  </Field.Root>
                </Box>
              </Box>
            );
          })}

          {/* ---------------------------------------------------------------- grounding */}

          <Box padding={4} hasRadius background="neutral0" borderColor="neutral200">
            <Flex justifyContent="space-between" alignItems="center">
              <Typography variant="delta">Project structure in the prompt</Typography>
              <Toggle
                name="grounding-enabled"
                onLabel="On"
                offLabel="Off"
                checked={grounding && !groundingLockedByConfig}
                /*
                 * Rendered DISABLED when the deploy-time hard off-switch is holding it off, with a
                 * hint naming the key — an administrator is never left flipping a control that does
                 * nothing (contracts/install-description.md §7).
                 */
                disabled={groundingLockedByConfig}
                onChange={() => setGrounding((v) => !v)}
              />
            </Flex>
            <Box paddingTop={2}>
              <Typography variant="pi" textColor="neutral600">
                {groundingLockedByConfig
                  ? 'Turned off for this deployment by the grounding.enabled plugin config key. Change it in the host application’s config/plugins.ts to re-enable this control.'
                  : 'Embeds a generated description of this project’s content types, fields, components and preview targets in the assistant’s instructions, so it stops guessing at field names. It is deterministic, size-bounded and filtered to what your account can read — and it AUTHORIZES NOTHING: every read and every change is still checked against your own permissions.'}
              </Typography>
            </Box>

            {/*
              The read-only inspector (FR-035): the EXACT text requests are carrying for this
              account, its tier, and its size against the budget. Not a re-render and not a sample —
              if the inspector and the request could disagree, the inspector is worthless.
            */}
            {inspector ? (
              <Box marginTop={3}>
                <Typography variant="pi" fontWeight="bold" textColor="neutral700">
                  {inspector.enabled && inspector.text
                    ? `Currently sent — ${inspector.charCount.toLocaleString()} of ${inspector.maxChars.toLocaleString()} characters, tier "${inspector.tier}"${
                        inspector.partial ? ' (shortened to fit)' : ''
                      }, ${inspector.contentTypeCount} content type${
                        inspector.contentTypeCount === 1 ? '' : 's'
                      }${
                        inspector.omittedContentTypeCount > 0
                          ? `, ${inspector.omittedContentTypeCount} omitted`
                          : ''
                      }`
                    : 'Requests are currently carrying no project description.'}
                </Typography>
                {inspector.enabled && inspector.text ? (
                  <Box
                    marginTop={2}
                    padding={3}
                    hasRadius
                    background="neutral100"
                    borderColor="neutral200"
                    style={{ maxHeight: '22rem', overflow: 'auto' }}
                  >
                    <pre
                      style={{
                        margin: 0,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        fontSize: '1.15rem',
                        lineHeight: 1.45,
                      }}
                    >
                      {inspector.text}
                    </pre>
                  </Box>
                ) : null}
              </Box>
            ) : null}
          </Box>

          {/*
            The content brief. A SEPARATE card from the structure description above, because the two
            are different bargains and an operator has to be able to see which one they are buying:
            the description is deterministic, free and always current; the brief reads real content,
            costs provider calls, and is only as current as its last run.
          */}
          <Box padding={4} hasRadius background="neutral0" borderColor="neutral200">
            <Typography variant="delta">Content briefing</Typography>
            <Box paddingTop={2}>
              <Typography variant="pi" textColor="neutral600">
                A one-off run that reads a sample of this project’s real entries and writes a short,
                human-readable briefing: one paragraph on what this project is, then one per content
                type on what it is for and how it is actually used.
              </Typography>
            </Box>

            <Box marginTop={3}>
              <Field.Root
                name="brief-source"
                hint={
                  !grounding || groundingLockedByConfig
                    ? 'Turn the structure switch above on to use either source — it is the one control for putting generated context in the prompt at all.'
                    : briefSource === 'brief'
                      ? 'The briefing replaces the structure description. The assistant keeps exact field names through its read tools, but loses the dotted media-slot paths the description lists up front.'
                      : briefSource === 'both'
                        ? 'Structure first, briefing second. Each has its own character budget, so together they cannot crowd out the conversation.'
                        : 'The current behaviour: schema-derived structure only. No content is read.'
                }
              >
                <Field.Label>What the assistant’s instructions carry</Field.Label>
                <SingleSelect
                  value={briefSource}
                  onChange={(value: string | number) => setBriefSource(String(value) as GroundingSource)}
                  disabled={!grounding || groundingLockedByConfig}
                >
                  {(Object.keys(SOURCE_LABEL) as GroundingSource[]).map((id) => (
                    <SingleSelectOption key={id} value={id}>
                      {SOURCE_LABEL[id]}
                    </SingleSelectOption>
                  ))}
                </SingleSelect>
                <Field.Hint />
              </Field.Root>
            </Box>

            <Box marginTop={3}>
              <Field.Root
                name="brief-depth"
                hint="Entries are sampled from both ends of the update order, so the briefing reflects what the project has settled into as well as what it is doing now."
              >
                <Field.Label>How much content one run reads</Field.Label>
                <SingleSelect
                  value={briefDepth}
                  onChange={(value: string | number) => setBriefDepth(String(value) as BriefDepth)}
                >
                  {(Object.keys(DEPTH_LABEL) as BriefDepth[]).map((id) => (
                    <SingleSelectOption key={id} value={id}>
                      {DEPTH_LABEL[id]}
                    </SingleSelectOption>
                  ))}
                </SingleSelect>
                <Field.Hint />
              </Field.Root>
            </Box>

            {/*
              ⚠ THE COST STATEMENT. Shown BEFORE the run, in the units an operator can actually
              reason about — content types, entries read, and calls billed — because this is the one
              control in this plugin that spends real money on activation, and a number after the
              fact is not a warning.
            */}
            {brief ? (
              <Box marginTop={3} padding={3} hasRadius background="neutral100" borderColor="neutral200">
                <Typography variant="pi" fontWeight="bold" textColor="neutral700">
                  What a full run costs
                </Typography>
                <Box paddingTop={1}>
                  <Typography variant="pi" textColor="neutral600">
                    {brief.readableCount} content type{brief.readableCount === 1 ? '' : 's'} ×{' '}
                    {DEPTH_SAMPLE[briefDepth]} entries read ={' '}
                    <strong>
                      {brief.estimate.modelCalls} model call
                      {brief.estimate.modelCalls === 1 ? '' : 's'}
                    </strong>{' '}
                    billed to your active provider — one per content type
                    {brief.scopeToReader ? '' : ', plus one for the project overview'} — run
                    sequentially. Expect roughly{' '}
                    {Math.max(1, Math.round((brief.estimate.modelCalls * 4) / 60))}–
                    {Math.max(1, Math.round((brief.estimate.modelCalls * 12) / 60))} minute
                    {brief.estimate.modelCalls > 15 ? 's' : ''}. Re-running replaces every section.
                  </Typography>
                </Box>
                {/*
                  WHO WILL READ IT, stated next to what it costs and before the button is armed.
                  The default shares one briefing with every account that can use the chat, which is
                  a real disclosure — an operator must not discover it afterwards.
                */}
                <Box paddingTop={2}>
                  <Typography variant="pi" textColor="neutral600">
                    {brief.scopeToReader
                      ? 'Every account is served only the sections its own permissions allow, and the project overview is withheld. Set contentBrief.scopeToReader to false in the host application’s config/plugins.ts for one shared briefing.'
                      : 'One briefing, identical for every account that can use the chat — overview included — regardless of their own content permissions. It never describes a content type you cannot read yourself, and it changes nothing about what the assistant may do: every read and every change is still checked against the acting account. Set contentBrief.scopeToReader to true in the host application’s config/plugins.ts to serve each reader only their own sections instead.'}
                  </Typography>
                </Box>
                {/*
                  ⚠ RENDERED-PAGE GROUNDING'S ADDED COST, stated in the SAME panel and before the
                  same arm-then-confirm control (005 FR-024, SC-011). The panel is EXTENDED, not
                  replaced: the model-call count above is what it always was, and the claim that
                  makes SC-011 checkable is that page reading does not change it.
                */}
                {brief.estimate.pageReading?.enabled ? (
                  <Box paddingTop={2}>
                    <Typography variant="pi" textColor="neutral600">
                      Rendered-page grounding is <strong>on</strong>.{' '}
                      {brief.estimate.pageReading.withPreviewTarget} content type
                      {brief.estimate.pageReading.withPreviewTarget === 1 ? ' has' : 's have'} a
                      preview target configured, so the run additionally makes{' '}
                      <strong>
                        {brief.estimate.pageReading.withPreviewTarget} HTTP fetch
                        {brief.estimate.pageReading.withPreviewTarget === 1 ? '' : 'es'}
                      </strong>{' '}
                      of your own front end — each bounded to{' '}
                      {Math.round(brief.estimate.pageReading.timeoutMs / 1000)} second
                      {brief.estimate.pageReading.timeoutMs === 1000 ? '' : 's'} and{' '}
                      {Math.round(brief.estimate.pageReading.maxBytes / 1000)} kB, same-origin only,
                      with no cookies and no credentials. Each fetch feeds the{' '}
                      <strong>same single model call</strong> for that content type rather than
                      adding one, so the number of billed calls above is unchanged. Nothing fetched
                      is stored: only the model’s prose reaches a section. Content types with no
                      preview target are described from their entries exactly as before.
                    </Typography>
                  </Box>
                ) : null}
                {/*
                  Degradation is RECORDED, never hidden (FR-023, SC-012). An operator who turned
                  page reading on and got no benefit must be able to see which content types it
                  could not reach and what stopped it.
                */}
                {brief.pageReadingFailures && brief.pageReadingFailures.length > 0 ? (
                  <Box paddingTop={2}>
                    <Typography variant="pi" textColor="neutral600">
                      On the last run, {brief.pageReadingFailures.length} content type
                      {brief.pageReadingFailures.length === 1 ? '' : 's'} fell back to an entry-only
                      section:{' '}
                      {brief.pageReadingFailures
                        .map(
                          (failure) =>
                            `${failure.uid} (${PAGE_READING_REASONS[failure.reason] ?? failure.reason})`
                        )
                        .join('; ')}
                      .
                    </Typography>
                  </Box>
                ) : null}
                {brief.autoRefresh ? (
                  <Box paddingTop={2}>
                    <Typography variant="pi" textColor="neutral600">
                      After the first run, sections whose content or schema changed are refreshed
                      automatically during chat sessions — at most{' '}
                      {brief.maxAutoRefreshSections} content type
                      {brief.maxAutoRefreshSections === 1 ? '' : 's'} per pass and no more than once
                      every {brief.refreshThrottleMinutes} minutes. That is the only way this
                      feature spends anything without a click; set contentBrief.autoRefresh to false
                      in the host application’s config/plugins.ts to disable it.
                    </Typography>
                  </Box>
                ) : null}
              </Box>
            ) : null}

            {/* The state of the stored brief: coverage, staleness, and live progress. */}
            {brief ? (
              <Box marginTop={3}>
                <Typography variant="pi" fontWeight="bold" textColor="neutral700">
                  {brief.run.active
                    ? `Running — ${brief.run.doneCount} of ${brief.run.totalCount} done${
                        brief.run.currentUid ? `, on ${brief.run.currentUid}` : ''
                      }`
                    : brief.run.state === 'never-run'
                      ? 'No briefing has been generated yet.'
                      : `${brief.sectionCount} content type${
                          brief.sectionCount === 1 ? '' : 's'
                        } described${
                          brief.run.completedAt
                            ? `, last run ${new Date(brief.run.completedAt).toLocaleString()}`
                            : ''
                        }${brief.staleCount > 0 ? `, ${brief.staleCount} out of date` : ''}${
                          brief.missingCount > 0 ? `, ${brief.missingCount} never described` : ''
                        }`}
                </Typography>
                {brief.run.error ? (
                  <Box paddingTop={1}>
                    <Typography variant="pi" textColor="danger600">
                      {brief.run.error}
                    </Typography>
                  </Box>
                ) : null}
              </Box>
            ) : null}

            {/*
              Activating Run only ARMS the confirmation — the same rule the Approve & Publish action
              follows, and for the same reason: one click must never be enough to start something
              that spends money and cannot be un-spent.
            */}
            {runIntent ? (
              <Box
                marginTop={3}
                padding={3}
                hasRadius
                background="danger100"
                borderColor="danger200"
              >
                <Typography variant="pi" fontWeight="bold" textColor="danger700">
                  Start a run of {brief?.estimate.modelCalls ?? 0} model call
                  {(brief?.estimate.modelCalls ?? 0) === 1 ? '' : 's'}?
                </Typography>
                <Box paddingTop={1}>
                  <Typography variant="pi" textColor="danger700">
                    This bills your active provider and replaces every existing section. It cannot be
                    cancelled once started.
                  </Typography>
                </Box>
                <Flex gap={2} paddingTop={2}>
                  <Button variant="danger" onClick={() => void onRunBrief()} loading={briefBusy}>
                    Yes, run it
                  </Button>
                  <Button variant="tertiary" onClick={() => setRunIntent(false)} disabled={briefBusy}>
                    Cancel
                  </Button>
                </Flex>
              </Box>
            ) : null}

            <Flex gap={2} marginTop={3}>
              <Button
                variant="secondary"
                onClick={() => setRunIntent(true)}
                disabled={
                  briefBusy || runIntent || Boolean(brief?.run.active) || brief?.enabled === false
                }
              >
                {brief?.run.state === 'never-run' ? 'Generate briefing' : 'Re-run briefing'}
              </Button>
              {brief?.run.active ? (
                <Typography variant="pi" textColor="neutral600">
                  Running in the background — you can leave this page.
                </Typography>
              ) : null}
            </Flex>

            {brief?.enabled === false ? (
              <Box paddingTop={2}>
                <Typography variant="pi" textColor="neutral600">
                  Turned off for this deployment by the contentBrief.enabled plugin config key.
                  Change it in the host application’s config/plugins.ts to re-enable this control.
                </Typography>
              </Box>
            ) : null}

            {/* The stored prose, so an administrator can read exactly what the assistant is told. */}
            {brief && (brief.sections.length > 0 || brief.overview) ? (
              <Box
                marginTop={3}
                padding={3}
                hasRadius
                background="neutral100"
                borderColor="neutral200"
                style={{ maxHeight: '22rem', overflow: 'auto' }}
              >
                {brief.overview ? (
                  <Box paddingBottom={3}>
                    <Typography variant="pi" fontWeight="bold" textColor="neutral700">
                      What this project is
                    </Typography>
                    <Box paddingTop={1}>
                      <Typography variant="pi" textColor="neutral700">
                        {brief.overview}
                      </Typography>
                    </Box>
                  </Box>
                ) : null}
                {brief.sections.map((section) => (
                  <Box key={section.uid} paddingBottom={3}>
                    <Typography variant="pi" fontWeight="bold" textColor="neutral700">
                      {section.uid}
                      {section.stale ? ' — out of date' : ''}
                    </Typography>
                    <Box paddingTop={1}>
                      <Typography variant="pi" textColor="neutral700">
                        {section.text}
                      </Typography>
                    </Box>
                    <Box paddingTop={1}>
                      <Typography variant="pi" textColor="neutral500">
                        {section.sampledCount} of {section.totalCount} entries read ·{' '}
                        {new Date(section.generatedAt).toLocaleDateString()}
                      </Typography>
                    </Box>
                  </Box>
                ))}
              </Box>
            ) : null}
          </Box>

          {activeEntry?.requiresBaseUrl ? (
            <Typography variant="pi" textColor="neutral600">
              The active provider requires a Base URL. Without a valid one, requests are refused
              before generation begins rather than failing mid-reply.
            </Typography>
          ) : null}

          <Flex>
            <Button onClick={onSave} loading={saving} disabled={saving}>
              {formatMessage({ id: getTranslation('settings.save'), defaultMessage: 'Save' })}
            </Button>
          </Flex>
        </Flex>
      </Box>
    </Page.Main>
  );
};

export const Settings = () => (
  <Page.Protect permissions={PERMISSIONS.settingsRead}>
    <SettingsForm />
  </Page.Protect>
);

export default Settings;
