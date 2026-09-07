import {
  normalizeSettings,
  parseBaseUrl,
  isGroundingEnabledFrom,
  type StudioSettings,
} from './config';

/**
 * Configuration normalization and validation (FR-006, FR-008, FR-036).
 *
 * Every rule here is an upgrade-safety or a secret-safety rule, and all of them are pure — no
 * Strapi runtime, no plugin store, no crypto service.
 */

describe('normalizeSettings — upgrade safety', () => {
  it('returns full defaults for a store that has never been written', () => {
    for (const empty of [null, undefined]) {
      const settings = normalizeSettings(empty);
      expect(settings.activeProvider).toBe('anthropic');
      expect(settings.grounding).toEqual({ enabled: true });
      expect(Object.keys(settings.providers).sort()).toEqual([
        'anthropic',
        'google',
        'openai',
        'openai-compatible',
      ]);
    }
  });

  it('gives every missing field its default rather than leaving it undefined', () => {
    // An install written by an older build has no `grounding` and no `baseUrl` anywhere.
    const settings = normalizeSettings({
      activeProvider: 'openai',
      activeModel: 'some-saved-identifier',
      providers: { openai: { apiKeyEnc: 'ct', isSet: true, enabled: true } as never },
    });
    expect(settings.grounding).toEqual({ enabled: true });
    expect(settings.providers.openai.baseUrl).toBeNull();
    // Providers absent from the stored blob are seeded, not dropped.
    expect(settings.providers['openai-compatible']).toEqual({
      apiKeyEnc: null,
      isSet: false,
      enabled: false,
      baseUrl: null,
    });
  });

  it('preserves an unknown provider key on read (data-model §3)', () => {
    // A configuration for a provider THIS build does not offer must survive, so downgrading and
    // re-upgrading does not silently discard it.
    const settings = normalizeSettings({
      providers: {
        anthropic: { apiKeyEnc: null, isSet: false, enabled: false, baseUrl: null },
        'some-future-provider': { apiKeyEnc: 'ct', isSet: true, enabled: true, baseUrl: null },
      },
    } as Partial<StudioSettings>);
    expect(settings.providers['some-future-provider']).toBeDefined();
    expect(settings.providers['some-future-provider'].apiKeyEnc).toBe('ct');
    expect(settings.providers['some-future-provider'].enabled).toBe(true);
  });

  it('keeps activeModel verbatim, including a non-curated identifier (FR-004, FR-005)', () => {
    const odd = '  Weird_Model.Name-v2  ';
    expect(normalizeSettings({ activeModel: odd }).activeModel).toBe(odd);
  });

  it('carries activeProvider through even when this build does not ship it', () => {
    // The TABLE is the allow-list, enforced at resolve time as UNKNOWN_PROVIDER. Normalization
    // must not quietly rewrite the saved selection to a different provider.
    expect(normalizeSettings({ activeProvider: 'some-future-provider' }).activeProvider).toBe(
      'some-future-provider'
    );
  });

  it('defaults grounding to on but honours an explicit false (FR-036)', () => {
    expect(normalizeSettings({}).grounding.enabled).toBe(true);
    expect(normalizeSettings({ grounding: { enabled: false } }).grounding.enabled).toBe(false);
    expect(normalizeSettings({ grounding: { enabled: true } }).grounding.enabled).toBe(true);
  });
});

describe('normalizeSettings — isSet is derived, never trusted', () => {
  it('recomputes isSet from the ciphertext when input claims true but holds nothing', () => {
    const settings = normalizeSettings({
      providers: { anthropic: { apiKeyEnc: null, isSet: true, enabled: true, baseUrl: null } },
    });
    expect(settings.providers.anthropic.isSet).toBe(false);
  });

  it('recomputes isSet from the ciphertext when input claims false but holds one', () => {
    const settings = normalizeSettings({
      providers: { anthropic: { apiKeyEnc: 'ct', isSet: false, enabled: true, baseUrl: null } },
    });
    expect(settings.providers.anthropic.isSet).toBe(true);
  });
});

describe('parseBaseUrl — accepts real endpoints, refuses credentials (FR-008)', () => {
  it.each([
    'https://api.example.com/v1',
    'http://h:8080',
    // The self-hosted forms this feature exists to serve. `z.httpUrl()` rejects every one of
    // these, which is exactly why it is not used.
    'http://localhost:11434/v1',
    'http://127.0.0.1:8080/v1',
    'http://ollama:11434/v1',
  ])('accepts %s', (input) => {
    const result = parseBaseUrl(input);
    expect(result.ok).toBe(true);
  });

  it.each(['/v1', 'ftp://x.com', 'http:example.com', 'not a url', 'example.com'])(
    'rejects %s',
    (input) => {
      expect(parseBaseUrl(input).ok).toBe(false);
    }
  );

  it('rejects a userinfo component, so no credential hides in the endpoint field', () => {
    // `z.url()` accepts these; the refusal is ours. A credential smuggled in here would sit
    // outside the encrypted-key path entirely (Principle I).
    for (const input of ['https://user:pw@host.com', 'https://user@host.com', 'http://a:b@h:8080/v1']) {
      expect(parseBaseUrl(input).ok).toBe(false);
    }
  });

  it('trims trailing slashes so one endpoint written two ways stores once', () => {
    for (const input of ['https://api.example.com/v1/', 'https://api.example.com/v1///']) {
      const result = parseBaseUrl(input);
      expect(result).toEqual({ ok: true, value: 'https://api.example.com/v1' });
    }
    expect(parseBaseUrl('https://api.example.com/')).toEqual({
      ok: true,
      value: 'https://api.example.com',
    });
  });

  it('treats null, undefined and blank as CLEAR rather than invalid', () => {
    for (const input of [null, undefined, '', '   ']) {
      expect(parseBaseUrl(input)).toEqual({ ok: true, value: null });
    }
  });

  it('rejects a non-string', () => {
    for (const input of [42, {}, [], true]) {
      expect(parseBaseUrl(input).ok).toBe(false);
    }
  });

  it('never returns a message that echoes nothing useful', () => {
    const result = parseBaseUrl('/v1');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message.trim()).not.toBe('');
    }
  });
});

describe('isGroundingEnabledFrom — the two-switch precedence rule', () => {
  // contracts/install-description.md §7: embedded only when BOTH are true. The hard off-switch
  // cannot be re-enabled by the runtime toggle, which is the whole point of the AND.
  it.each([
    [true, true, true],
    [true, false, false],
    [false, true, false],
    [false, false, false],
  ])('config=%s settings=%s -> %s', (pluginEnabled, settingsEnabled, expected) => {
    expect(isGroundingEnabledFrom(pluginEnabled, settingsEnabled)).toBe(expected);
  });
});
