import type { Core } from '@strapi/strapi';

/**
 * The install's language-version facts, read from Strapi's own i18n plugin (research D8).
 *
 * WHY THIS SERVICE EXISTS AT ALL. FR-042 and SC-018 require that on a single-locale install this
 * whole capability be *structurally invisible* — not hidden behind a prompt clause, but absent: no
 * `locale` parameter in any composed tool schema, no language-version line in the situation block,
 * no locale control in the Focus picker. Every one of those decisions needs the same two facts, on
 * every request, so they are resolved once here rather than re-derived at each site with a slightly
 * different guard.
 *
 * EVERY CALL GUARDS ON THE PLUGIN BEING PRESENT. `@strapi/i18n@5.48.1` ships as a dependency of
 * `@strapi/strapi@5.48.1`, but a host may disable it — and a host that has is not an error case, it
 * is a single-locale install. So an absent plugin degrades to `NO_LOCALES` rather than throwing.
 *
 * VERIFIED AGAINST THE INSTALLED PACKAGE before a line was written against it (the rule this
 * repository applies to model identifiers, applied to APIs). In `@strapi/i18n@5.48.1`:
 *   - `service('locales').find(params?)` -> `Promise<any[]>`, rows from `plugin::i18n.locale`, each
 *     carrying `code` and `name` (`dist/server/services/locales.js`);
 *   - `service('locales').getDefaultLocale()` -> `Promise<unknown>`, the core-store `default_locale`
 *     value, which is written from `{ code }` and is therefore a CODE STRING, not a row;
 *   - `service('content-types').isLocalizedContentType(model)` -> `boolean`, implemented as exactly
 *     `prop('pluginOptions.i18n.localized', model) === true` (`dist/server/services/content-types.js`).
 *
 * That last equivalence is why the no-plugin fallback below is faithful rather than approximate: it
 * is the same predicate, evaluated here instead of there. Strapi's own is still preferred when it is
 * available — preferring a predicate Strapi already ships is the constitution's conflict ordering
 * applied normally, not an exception to it.
 */

/* ------------------------------------------------------------------ the pure core */

/**
 * What the rest of the feature needs to know about language versions. Nothing else belongs here:
 * a locale's display name is a picker concern, and the picker reads `codes` and asks separately.
 */
export interface LocaleFacts {
  /** Every locale code the install has, in a FIXED byte order. Empty when i18n is absent. */
  codes: string[];
  /** The install's default locale code, or null when there is none to read. */
  defaultLocale: string | null;
  /**
   * The switch FR-042 turns on. TRUE ONLY WITH MORE THAN ONE LOCALE — an install with exactly one
   * is indistinguishable from one with none, which is what SC-018 asks for: there is nothing to
   * choose between, so nothing offers a choice.
   */
  multiLocale: boolean;
}

/** An install with no i18n plugin, or none that answered. Also the shape every failure degrades to. */
export const NO_LOCALES: LocaleFacts = Object.freeze({
  codes: [],
  defaultLocale: null,
  multiLocale: false,
});

/**
 * A FIXED BYTE ORDERING, never `localeCompare` — the same rule `grounding.ts` follows and for the
 * same reason: a locale-dependent sort makes two hosts compose different text from one input.
 */
const byBytes = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Build the facts from whatever the i18n plugin returned. TOTAL BY CONSTRUCTION: every input is
 * `unknown`, because both values cross a plugin boundary this code does not own, and a malformed
 * row must read back as "no locales" rather than throw inside a chat turn.
 *
 * The default locale is only reported when it is actually one of the install's locales. A
 * `default_locale` core-store value naming a deleted locale is a host-side inconsistency, and
 * reporting it would send US2's sampling (T023) after a locale that holds nothing.
 */
export const deriveLocaleFacts = (rows: unknown, defaultLocale: unknown): LocaleFacts => {
  const codes = Array.isArray(rows)
    ? [
        ...new Set(
          rows
            .map((row) => (row as { code?: unknown } | null)?.code)
            .filter((code): code is string => typeof code === 'string' && code.trim() !== '')
        ),
      ].sort(byBytes)
    : [];

  const declared = typeof defaultLocale === 'string' && defaultLocale.trim() !== '' ? defaultLocale : null;

  return {
    codes,
    /*
     * Fall back to the sole locale when the store holds nothing usable: an install with one locale
     * and no recorded default still has an unambiguous answer, and US2 needs one to sample.
     */
    defaultLocale:
      declared && codes.includes(declared) ? declared : codes.length === 1 ? (codes[0] as string) : null,
    multiLocale: codes.length > 1,
  };
};

/**
 * The no-plugin fallback for `isLocalizedContentType`, and deliberately the SAME expression Strapi's
 * own predicate uses rather than a looser one. `unknown` in, because a schema reaches here from
 * `strapi.contentTypes` without a declared shape.
 */
export const isLocalizedSchema = (schema: unknown): boolean =>
  (schema as { pluginOptions?: { i18n?: { localized?: unknown } } } | null)?.pluginOptions?.i18n
    ?.localized === true;

/* ------------------------------------------------------- per-request memoization */

/** The key the memo hangs off. A symbol, so it cannot collide with anything else on `ctx.state`. */
const MEMO_KEY = Symbol.for('ai-content-studio.localeFacts');

/** Where a memo may be kept for the life of one request, or null when there is no request in flight. */
export type MemoStore = () => Record<symbol, unknown> | null;

/**
 * Memoize the facts FOR ONE REQUEST, and for no longer.
 *
 * The lifetime matters in both directions. Longer — a module-level cache — would make an install
 * that adds a second locale keep behaving as single-locale until the host restarts, which is
 * exactly the kind of stale capability gate that is invisible until someone reports it. Shorter —
 * no memo — would re-query on every one of the several sites a single turn consults (the situation
 * block, the tool schemas, the focus resolution, the briefing index), for facts that cannot change
 * mid-request.
 *
 * THE PROMISE IS CACHED, NOT THE VALUE, so two concurrent callers inside one request share one
 * query rather than racing two. The loader below never rejects, so a cached rejection is not a
 * state this can reach.
 *
 * Pure, and takes its store as a parameter, so the suite can drive the memoization itself without a
 * Strapi runtime — the same shape `grounding.ts` uses for its private-attributes resolver.
 */
export const createMemoizedFacts = (
  load: () => Promise<LocaleFacts>,
  store: MemoStore
): (() => Promise<LocaleFacts>) => {
  return () => {
    const bucket = store();
    if (!bucket) {
      // No request in flight — a briefing run started from the settings page, say. Correct to skip
      // the memo entirely rather than invent a scope for it.
      return load();
    }
    const existing = bucket[MEMO_KEY];
    if (existing) {
      return existing as Promise<LocaleFacts>;
    }
    const pending = load();
    bucket[MEMO_KEY] = pending;
    return pending;
  };
};

/* ---------------------------------------------------------------- the service */

const localesService = ({ strapi }: { strapi: Core.Strapi }) => {
  const i18n = (): any => (strapi as any).plugin?.('i18n') ?? null;

  /**
   * Read both facts from the plugin. NEVER REJECTS: an absent plugin, a plugin that throws, or a
   * shape this code does not recognise all degrade to `NO_LOCALES`, because every caller of this is
   * inside a chat turn or a briefing run and none of them may fail over a language-version lookup.
   */
  const load = async (): Promise<LocaleFacts> => {
    const plugin = i18n();
    if (!plugin) {
      return NO_LOCALES;
    }
    try {
      const service = plugin.service('locales');
      const [rows, defaultLocale] = await Promise.all([
        service.find(),
        service.getDefaultLocale(),
      ]);
      return deriveLocaleFacts(rows, defaultLocale);
    } catch (err) {
      strapi.log.warn(
        `[ai-content-studio] could not read the install's locales; treating it as single-locale: ${
          strapi.plugin('ai-content-studio').service('redact').describeError(err)
        }`
      );
      return NO_LOCALES;
    }
  };

  const facts = createMemoizedFacts(load, () => {
    // `strapi.requestContext.get()` is Strapi's own AsyncLocalStorage-backed accessor for the Koa
    // context of the request currently in flight (`@strapi/types` Modules.RequestContext). Hanging
    // the memo off `ctx.state` means it is collected with the request and can never outlive it.
    const ctx = strapi.requestContext?.get?.();
    return (ctx?.state as Record<symbol, unknown> | undefined) ?? null;
  });

  return {
    /** The install's language-version facts, resolved once per request. Never throws. */
    facts,

    /**
     * Whether one content type holds separate language versions.
     *
     * Synchronous on purpose: it reads a schema that is already in memory, and every call site
     * (tool schema composition, Focus resolution, the picker) is inside a path that would otherwise
     * have to become async for a property lookup.
     */
    isLocalized(uid: string): boolean {
      const schema = (strapi.contentTypes as Record<string, unknown>)[uid];
      if (!schema) {
        return false;
      }
      try {
        const contentTypes = i18n()?.service('content-types');
        if (contentTypes?.isLocalizedContentType) {
          return Boolean(contentTypes.isLocalizedContentType(schema));
        }
      } catch {
        // Fall through to the predicate below — an i18n plugin that throws is not a reason to fail
        // a turn, and the fallback computes the same expression.
      }
      return isLocalizedSchema(schema);
    },
  };
};

export default localesService;
