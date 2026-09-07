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

interface SettingsResponse {
  activeProvider: string;
  activeModel: string;
  providers: Record<string, MaskedProviderState>;
  grounding: { enabled: boolean };
}

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
  const { get, put } = useFetchClient();
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

  const hydrate = React.useCallback((data: SettingsResponse) => {
    setServer(data);
    setActiveProvider(data.activeProvider);
    setActiveModel(data.activeModel);
    setGrounding(data.grounding?.enabled !== false);
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

  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data } = await get('/ai-content-studio/settings');
        if (active) {
          hydrate(data as SettingsResponse);
        }
        await loadInspector();
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
  }, [get, hydrate, loadInspector, toggleNotification, formatMessage]);

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
      if (Object.keys(providers).length > 0) {
        body.providers = providers;
      }

      const { data } = await put('/ai-content-studio/settings', body);
      hydrate(data as SettingsResponse);
      await loadInspector();
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
