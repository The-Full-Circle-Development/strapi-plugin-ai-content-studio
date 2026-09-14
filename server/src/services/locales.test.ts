import {
  createMemoizedFacts,
  deriveLocaleFacts,
  isLocalizedSchema,
  NO_LOCALES,
  type LocaleFacts,
} from './locales';

/**
 * The install's language-version facts (research D8, contracts/situation-and-focus.md §4.1).
 *
 * Everything asserted here is a pure function, so there is no Strapi runtime, no i18n plugin and no
 * database. What the suite CANNOT cover is that `@strapi/i18n` returns the shapes these functions
 * are fed — that was verified by reading the installed package, and it is recorded in the service's
 * own doc comment rather than mocked into a test that would pass whether or not it was still true.
 *
 * The load-bearing property throughout is TOTALITY: every one of these runs inside a chat turn, and
 * none of them may throw over a language-version lookup.
 */

describe('deriveLocaleFacts — single locale (SC-018)', () => {
  it('reports one locale as NOT multi-locale, which is what makes the capability vanish', () => {
    const facts = deriveLocaleFacts([{ code: 'en', name: 'English' }], 'en');
    expect(facts).toEqual({ codes: ['en'], defaultLocale: 'en', multiLocale: false });
  });

  it('is indistinguishable from an install with no i18n plugin at all', () => {
    // SC-018's actual requirement: a host that disabled i18n behaves EXACTLY as a single-locale
    // install. Both must answer `multiLocale: false`, because that is the only flag anything reads.
    expect(deriveLocaleFacts([{ code: 'en' }], 'en').multiLocale).toBe(
      deriveLocaleFacts([], null).multiLocale
    );
  });

  it('answers the sole locale as the default even when the store recorded none', () => {
    // An install with one locale has an unambiguous default whether or not `default_locale` was
    // ever written. US2's sampling (FR-040) needs one, and inventing `null` here would make it
    // sample every language version and re-inflate the counts the feature exists to fix.
    expect(deriveLocaleFacts([{ code: 'uk' }], undefined).defaultLocale).toBe('uk');
  });
});

describe('deriveLocaleFacts — multiple locales', () => {
  it('reports every code in a FIXED byte order, never the order the plugin returned them in', () => {
    const asGiven = deriveLocaleFacts([{ code: 'uk' }, { code: 'en' }, { code: 'de' }], 'en');
    const reversed = deriveLocaleFacts([{ code: 'de' }, { code: 'en' }, { code: 'uk' }], 'en');
    expect(asGiven.codes).toEqual(['de', 'en', 'uk']);
    expect(asGiven).toEqual(reversed);
    expect(asGiven.multiLocale).toBe(true);
  });

  it('de-duplicates codes, so a duplicated row cannot make a single-locale install look multi', () => {
    expect(deriveLocaleFacts([{ code: 'en' }, { code: 'en' }], 'en')).toEqual({
      codes: ['en'],
      defaultLocale: 'en',
      multiLocale: false,
    });
  });

  it('refuses a default locale that is not one of the install’s locales', () => {
    // A `default_locale` naming a deleted locale is a host-side inconsistency. Reporting it would
    // send the briefing run (T023) to sample a locale that holds nothing.
    const facts = deriveLocaleFacts([{ code: 'en' }, { code: 'uk' }], 'fr');
    expect(facts.defaultLocale).toBeNull();
    expect(facts.codes).toEqual(['en', 'uk']);
  });
});

describe('deriveLocaleFacts is total — a malformed answer degrades, never throws', () => {
  const malformed: Array<[string, unknown, unknown]> = [
    ['the plugin is absent, so nothing was read', null, null],
    ['an empty locale table', [], null],
    ['not an array at all', { code: 'en' }, 'en'],
    ['a string where rows were expected', 'en', 'en'],
    ['rows that are null', [null, undefined], 'en'],
    ['rows with no code', [{ name: 'English' }], 'en'],
    ['a code that is not a string', [{ code: 42 }], 'en'],
    ['a blank code', [{ code: '   ' }], 'en'],
    ['a default locale that is not a string', [{ code: 'en' }], { code: 'en' }],
    ['a blank default locale', [{ code: 'en' }], ''],
  ];

  it.each(malformed)('degrades on %s', (_label, rows, defaultLocale) => {
    expect(() => deriveLocaleFacts(rows, defaultLocale)).not.toThrow();
    const facts = deriveLocaleFacts(rows, defaultLocale);
    expect(Array.isArray(facts.codes)).toBe(true);
    expect(facts.multiLocale).toBe(facts.codes.length > 1);
  });

  it('reads back as NO_LOCALES when there is nothing usable to read', () => {
    expect(deriveLocaleFacts(null, null)).toEqual(NO_LOCALES);
    expect(deriveLocaleFacts([{ name: 'English' }], 'en')).toEqual(NO_LOCALES);
  });
});

describe('isLocalizedSchema — the no-plugin fallback', () => {
  it('is the SAME expression Strapi’s own predicate evaluates', () => {
    // `@strapi/i18n@5.48.1` implements isLocalizedContentType as exactly
    // `prop('pluginOptions.i18n.localized', model) === true`. The fallback is faithful, not looser:
    // only a literal `true` counts.
    expect(isLocalizedSchema({ pluginOptions: { i18n: { localized: true } } })).toBe(true);
    expect(isLocalizedSchema({ pluginOptions: { i18n: { localized: false } } })).toBe(false);
    expect(isLocalizedSchema({ pluginOptions: { i18n: { localized: 'true' } } })).toBe(false);
    expect(isLocalizedSchema({ pluginOptions: { i18n: { localized: 1 } } })).toBe(false);
  });

  it('is total over a schema that carries none of that path', () => {
    for (const schema of [null, undefined, {}, { pluginOptions: {} }, { pluginOptions: { i18n: {} } }, 'x', 7]) {
      expect(() => isLocalizedSchema(schema)).not.toThrow();
      expect(isLocalizedSchema(schema)).toBe(false);
    }
  });
});

describe('per-request memoization', () => {
  const factsFor = (codes: string[]): LocaleFacts => deriveLocaleFacts(
    codes.map((code) => ({ code })),
    codes[0] ?? null
  );

  it('reads once per request, however many callers ask', async () => {
    // A single turn consults these facts from the situation block, the tool schemas, the focus
    // resolution and the briefing index. That must be one query, not four.
    let loads = 0;
    const request: Record<symbol, unknown> = {};
    const facts = createMemoizedFacts(async () => {
      loads += 1;
      return factsFor(['en', 'uk']);
    }, () => request);

    const results = await Promise.all([facts(), facts(), facts(), facts()]);
    expect(loads).toBe(1);
    for (const result of results) {
      expect(result).toEqual(factsFor(['en', 'uk']));
    }
  });

  it('shares ONE in-flight read between concurrent callers, rather than racing two', async () => {
    let loads = 0;
    const request: Record<symbol, unknown> = {};
    const facts = createMemoizedFacts(async () => {
      loads += 1;
      await Promise.resolve();
      return factsFor(['en']);
    }, () => request);

    // Both calls start before either resolves — the promise is cached, not the value.
    await Promise.all([facts(), facts()]);
    expect(loads).toBe(1);
  });

  it('does NOT carry a memo across requests, so adding a locale takes effect without a restart', async () => {
    // The failure this rules out: an install that adds its second locale keeps behaving as
    // single-locale until the host restarts — a stale capability gate nobody would think to look for.
    let current = factsFor(['en']);
    let loads = 0;
    let request: Record<symbol, unknown> = {};
    const facts = createMemoizedFacts(async () => {
      loads += 1;
      return current;
    }, () => request);

    expect((await facts()).multiLocale).toBe(false);

    current = factsFor(['en', 'uk']);
    request = {}; // the next request gets its own state object
    expect((await facts()).multiLocale).toBe(true);
    expect(loads).toBe(2);
  });

  it('still answers when there is no request in flight, without inventing a scope for the memo', async () => {
    // A briefing run started from the settings page reaches these facts outside any Koa context.
    let loads = 0;
    const facts = createMemoizedFacts(async () => {
      loads += 1;
      return factsFor(['en']);
    }, () => null);

    expect(await facts()).toEqual(factsFor(['en']));
    expect(await facts()).toEqual(factsFor(['en']));
    expect(loads).toBe(2);
  });
});
