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
import { MODELS, PROVIDERS, PROVIDER_LABELS, type ProviderId } from '../data/models';
import { getTranslation } from '../utils/getTranslation';

interface MaskedProviderState {
  isSet: boolean;
  enabled: boolean;
  masked: string | null;
}
interface SettingsResponse {
  activeProvider: ProviderId;
  activeModel: string;
  providers: Record<ProviderId, MaskedProviderState>;
}

const emptyByProvider = <T,>(value: T): Record<ProviderId, T> =>
  PROVIDERS.reduce((acc, p) => {
    acc[p] = value;
    return acc;
  }, {} as Record<ProviderId, T>);

const SettingsForm = () => {
  const { formatMessage } = useIntl();
  const { get, put } = useFetchClient();
  const { toggleNotification } = useNotification();

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [server, setServer] = React.useState<SettingsResponse | null>(null);

  const [activeProvider, setActiveProvider] = React.useState<ProviderId>('anthropic');
  const [activeModel, setActiveModel] = React.useState<string>('');
  const [enabled, setEnabled] = React.useState<Record<ProviderId, boolean>>(emptyByProvider(false));
  const [keyInput, setKeyInput] = React.useState<Record<ProviderId, string>>(emptyByProvider(''));
  const [keyDirty, setKeyDirty] = React.useState<Record<ProviderId, boolean>>(emptyByProvider(false));

  const hydrate = React.useCallback((data: SettingsResponse) => {
    setServer(data);
    setActiveProvider(data.activeProvider);
    setActiveModel(data.activeModel);
    setEnabled(PROVIDERS.reduce((acc, p) => {
      acc[p] = data.providers[p]?.enabled ?? false;
      return acc;
    }, {} as Record<ProviderId, boolean>));
    setKeyInput(emptyByProvider(''));
    setKeyDirty(emptyByProvider(false));
  }, []);

  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data } = await get('/ai-content-studio/settings');
        if (active) {
          hydrate(data as SettingsResponse);
        }
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
  }, [get, hydrate, toggleNotification, formatMessage]);

  const onSave = async () => {
    setSaving(true);
    try {
      const providers: Partial<Record<ProviderId, { enabled?: boolean; apiKey?: string }>> = {};
      for (const p of PROVIDERS) {
        const patch: { enabled?: boolean; apiKey?: string } = {};
        if (server && enabled[p] !== server.providers[p]?.enabled) {
          patch.enabled = enabled[p];
        }
        if (keyDirty[p] && keyInput[p].trim() !== '') {
          patch.apiKey = keyInput[p].trim();
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
      if (Object.keys(providers).length > 0) {
        body.providers = providers;
      }

      const { data } = await put('/ai-content-studio/settings', body);
      hydrate(data as SettingsResponse);
      toggleNotification({
        type: 'success',
        message: formatMessage({
          id: getTranslation('settings.saveSuccess'),
          defaultMessage: 'AI settings saved.',
        }),
      });
    } catch {
      toggleNotification({
        type: 'danger',
        message: formatMessage({
          id: getTranslation('settings.saveError'),
          defaultMessage: 'Could not save AI settings.',
        }),
      });
    } finally {
      setSaving(false);
    }
  };

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
                const next = String(value) as ProviderId;
                setActiveProvider(next);
                if (!MODELS[next].some((m) => m.id === activeModel)) {
                  setActiveModel(MODELS[next][0].id);
                }
              }}
            >
              {PROVIDERS.map((p) => (
                <SingleSelectOption key={p} value={p}>
                  {PROVIDER_LABELS[p]}
                </SingleSelectOption>
              ))}
            </SingleSelect>
          </Field.Root>

          <Field.Root name="activeModel">
            <Field.Label>
              {formatMessage({ id: getTranslation('settings.activeModel'), defaultMessage: 'Active model' })}
            </Field.Label>
            <SingleSelect value={activeModel} onChange={(value: string | number) => setActiveModel(String(value))}>
              {MODELS[activeProvider].map((m) => (
                <SingleSelectOption key={m.id} value={m.id}>
                  {m.label}
                </SingleSelectOption>
              ))}
            </SingleSelect>
          </Field.Root>

          {PROVIDERS.map((p) => {
            const ps = server?.providers[p];
            return (
              <Box key={p} padding={4} hasRadius background="neutral0" borderColor="neutral200">
                <Flex justifyContent="space-between" alignItems="center">
                  <Typography variant="delta">{PROVIDER_LABELS[p]}</Typography>
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
              </Box>
            );
          })}

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
