import {
  normalizeSettings,
  normalizeBriefRun,
  emptyBriefRun,
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

/**
 * The content-brief selection (contracts/content-brief.md §2).
 *
 * The rule this suite exists to hold is that installing this feature changes nothing until someone
 * asks for it — an upgrade must not silently start reading content or composing a different prompt.
 */
describe('normalizeSettings — the content-brief selection', () => {
  it('defaults to the schema source, so an upgrade changes no prompt', () => {
    expect(normalizeSettings(null).contentBrief).toEqual({ source: 'schema', depth: 'deep' });
    // An install written before the feature existed reads back the same way.
    expect(
      normalizeSettings({ activeProvider: 'openai', activeModel: 'x', providers: {} }).contentBrief
    ).toEqual({ source: 'schema', depth: 'deep' });
  });

  it('honours every valid source and depth', () => {
    for (const source of ['schema', 'brief', 'both'] as const) {
      expect(normalizeSettings({ contentBrief: { source, depth: 'light' } } as never).contentBrief)
        .toEqual({ source, depth: 'light' });
    }
    for (const depth of ['light', 'standard', 'deep'] as const) {
      expect(normalizeSettings({ contentBrief: { source: 'both', depth } } as never).contentBrief)
        .toEqual({ source: 'both', depth });
    }
  });

  it('falls back to the default for an unrecognized value rather than preserving it', () => {
    /*
     * The OPPOSITE of the unknown-provider rule above, deliberately. A provider key this build does
     * not offer is configuration worth carrying through a downgrade; a grounding source this build
     * cannot assemble is a prompt it cannot compose, so it must resolve to one that works.
     */
    const settings = normalizeSettings({
      contentBrief: { source: 'telepathy', depth: 'exhaustive' },
    } as never);
    expect(settings.contentBrief).toEqual({ source: 'schema', depth: 'deep' });
  });

  it('takes each field independently, so a half-written record still reads', () => {
    expect(normalizeSettings({ contentBrief: { source: 'brief' } } as never).contentBrief).toEqual({
      source: 'brief',
      depth: 'deep',
    });
    expect(normalizeSettings({ contentBrief: { depth: 'light' } } as never).contentBrief).toEqual({
      source: 'schema',
      depth: 'light',
    });
  });
});

/**
 * The run record is written by a background task every few seconds and read by a settings page. It
 * is therefore the one record in this plugin most likely to be read half-written — after a process
 * died mid-run — so `normalizeBriefRun` has to be total.
 */
describe('normalizeBriefRun — total by construction', () => {
  it('reads an unwritten store as never-run', () => {
    for (const empty of [null, undefined]) {
      expect(normalizeBriefRun(empty)).toEqual(emptyBriefRun());
    }
  });

  it('gives every missing field its default', () => {
    const run = normalizeBriefRun({ state: 'running' });
    expect(run.state).toBe('running');
    expect(run.doneCount).toBe(0);
    expect(run.totalCount).toBe(0);
    expect(run.startedAt).toBeNull();
    expect(run.error).toBeNull();
  });

  it('refuses a state it does not know, rather than carrying it', () => {
    // A state nothing can interpret would leave the settings page unable to say what is happening,
    // and `isRunActive` unable to decide whether a lock is held.
    expect(normalizeBriefRun({ state: 'thinking' } as never).state).toBe('never-run');
  });

  it('treats a blank overview as none, so an empty paragraph never reaches a prompt', () => {
    expect(normalizeBriefRun({ overview: '   \n ' } as never).overview).toBeNull();
    expect(normalizeBriefRun({ overview: 42 } as never).overview).toBeNull();
    expect(normalizeBriefRun({ overview: 'A documentation portal.' }).overview).toBe(
      'A documentation portal.'
    );
  });

  it('rejects non-integer counters and non-string timestamps', () => {
    const run = normalizeBriefRun({
      doneCount: 2.5,
      totalCount: 'many',
      startedAt: 12345,
      lastRunByUserId: 'me',
    } as never);
    expect(run.doneCount).toBe(0);
    expect(run.totalCount).toBe(0);
    expect(run.startedAt).toBeNull();
    expect(run.lastRunByUserId).toBeNull();
  });

  it('keeps a valid record intact through a round trip', () => {
    const record = {
      state: 'ready' as const,
      depth: 'standard' as const,
      overview: 'A marketing site built around landing pages and a small blog.',
      startedAt: '2026-09-14T10:00:00.000Z',
      completedAt: '2026-09-14T10:04:00.000Z',
      currentUid: null,
      doneCount: 12,
      totalCount: 12,
      error: null,
      lastRunByUserId: 7,
      lastAutoRefreshAt: '2026-09-14T11:00:00.000Z',
    };
    expect(normalizeBriefRun(record)).toEqual(record);
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
