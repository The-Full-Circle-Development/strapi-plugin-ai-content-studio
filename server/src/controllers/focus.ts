import { z } from 'zod';
import type { Core } from '@strapi/strapi';

/**
 * The Focus picker's data (005 contracts/situation-and-focus.md §1.2, FR-014).
 *
 * TWO SMALL READ-ONLY ROUTES, AND THE ALTERNATIVE WAS NOT FREE. The picker could have called
 * Strapi's own `/content-manager/collection-types/:uid` from the admin bundle and added no plugin
 * surface at all — but that binds this plugin's admin bundle to ANOTHER plugin's route and response
 * shape across Strapi upgrades, and the spec's own assumption for Focus is that it must not depend
 * on admin internals that shift. Two routes through `permission-checker` — the mechanism this
 * plugin already uses and already tests against — are cheaper to keep true.
 *
 * ⚠ BOTH ROUTES FOLLOW THE SAME FOUR STEPS EVERY TOOL IN `tools.ts` FOLLOWS, IN THE SAME ORDER
 * (Principle II):
 *   1. validate the uid against the live `api::*` allow-list;
 *   2. RBAC-check the CALLER through `content-manager`'s `permission-checker` BEFORE touching the
 *      Document Service, which itself bypasses RBAC;
 *   3. return compact results;
 *   4. return structured, non-leaking failures rather than throwing.
 *
 * THEY RETURN NO FIELD VALUES BEYOND A DISPLAY LABEL. A picker needs to show which entry is which;
 * it does not need the entry. Anything more would make this a read API that bypasses the tools'
 * truncation and compaction rules.
 */

const entriesSchema = z.object({
  uid: z.string().min(1),
  q: z.string().max(200).optional(),
  locale: z.string().min(1).max(20).optional(),
});

/** A picker list is for choosing from, not for browsing. Bounded so it cannot become an export. */
const MAX_CANDIDATES = 25;

const focusController = ({ strapi }: { strapi: Core.Strapi }) => {
  const plugin = () => strapi.plugin('ai-content-studio');
  const focusSvc = () => plugin().service('focus');
  const localesSvc = () => plugin().service('locales');

  return {
    /**
     * Which content types this caller may focus, with whether each holds language versions.
     *
     * Filtered by the caller's own `can.read`, so the list itself discloses nothing: a content type
     * they cannot read is not named, which is the same rule the install description follows.
     */
    async contentTypes(ctx: any) {
      const userAbility = ctx.state.userAbility;
      const uids = Object.keys(strapi.contentTypes).filter((uid) => uid.startsWith('api::'));

      const readable = uids
        .filter((uid) => focusSvc().canRead(uid, userAbility))
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        .map((uid) => {
          const contentType = (strapi.contentTypes as Record<string, any>)[uid];
          return {
            uid,
            displayName: contentType?.info?.displayName ?? uid,
            kind: contentType?.kind ?? 'collectionType',
            localized: localesSvc().isLocalized(uid),
          };
        });

      /*
       * The install's locales travel with the list so the picker can render its language control —
       * or, on a single-locale install, render none at all (FR-042, SC-018). `multiLocale` is the
       * single flag every surface keys on, rather than each one re-deriving it from the length.
       */
      const facts = await localesSvc().facts();
      ctx.body = {
        contentTypes: readable,
        locales: facts.codes,
        defaultLocale: facts.defaultLocale,
        multiLocale: facts.multiLocale,
      };
      return undefined;
    },

    /**
     * A bounded candidate list for one content type: documentId, a display label, and the language
     * version each came back in.
     *
     * The label ladder is `focus.deriveLabel`, the SAME one the situation block and
     * `describePageStructure` use — a second ladder would mean the picker and the assistant show
     * different names for one entry.
     */
    async entries(ctx: any) {
      const parsed = entriesSchema.safeParse(ctx.request.query ?? {});
      if (!parsed.success) {
        return ctx.badRequest('Provide ?uid=<content-type-uid>.');
      }
      const { uid, q, locale } = parsed.data;

      if (!focusSvc().isAllowed(uid)) {
        return ctx.badRequest('That is not a content type this plugin can focus.');
      }
      if (!focusSvc().canRead(uid, ctx.state.userAbility)) {
        return ctx.forbidden('Your account does not have permission to read that content type.');
      }

      const contentType = (strapi.contentTypes as Record<string, any>)[uid];
      const displayName = contentType?.info?.displayName ?? uid;
      const isSingle = contentType?.kind === 'singleType';
      // A locale is honoured only where the content type actually holds language versions, so a
      // parameter that arrived on a non-localized type narrows nothing rather than erroring.
      const scope = localesSvc().isLocalized(uid) && locale ? { locale } : {};

      try {
        const docs = strapi.documents(uid as never) as any;

        if (isSingle) {
          const one = await docs.findFirst({ ...scope });
          ctx.body = {
            entries: one
              ? [
                  {
                    documentId: null,
                    label: focusSvc().deriveLabel(one, displayName),
                    locale: (one as { locale?: string })?.locale ?? null,
                  },
                ]
              : [],
          };
          return undefined;
        }

        /*
         * The search filters on the SAME fields the label ladder reads, so what the editor types
         * matches what they are shown. Searching fields the picker does not display would return
         * rows that look unrelated to the query.
         */
        const filters =
          q && q.trim() !== ''
            ? {
                $or: ['title', 'name', 'heading', 'label', 'slug']
                  .filter((field) => Boolean(contentType?.attributes?.[field]))
                  .map((field) => ({ [field]: { $containsi: q.trim() } })),
              }
            : undefined;

        // A filter with no matchable field would be `{ $or: [] }`, which matches nothing — so it is
        // dropped rather than applied, and the editor gets the unfiltered first page instead.
        const usableFilters =
          filters && Array.isArray(filters.$or) && filters.$or.length > 0 ? filters : undefined;

        const rows = await docs.findMany({
          ...(usableFilters ? { filters: usableFilters } : {}),
          sort: 'updatedAt:desc',
          limit: MAX_CANDIDATES,
          ...scope,
        });

        ctx.body = {
          entries: (Array.isArray(rows) ? rows : []).map((row: any) => ({
            documentId: row.documentId,
            label: focusSvc().deriveLabel(row, displayName),
            // FR-039: every result reports the version it actually came back in.
            locale: row.locale ?? null,
          })),
        };
        return undefined;
      } catch (err) {
        strapi.log.warn(
          `[ai-content-studio] focus entry lookup failed: ${plugin().service('redact').describeError(err)}`
        );
        // An empty list, never an internal error: the picker degrades to "no candidates" and the
        // editor can still type a different search.
        ctx.body = { entries: [] };
        return undefined;
      }
    },
  };
};

export default focusController;
