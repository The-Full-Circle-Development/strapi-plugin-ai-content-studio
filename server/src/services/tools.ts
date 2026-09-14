import { tool } from 'langchain';
import { z } from 'zod';
import type { Core } from '@strapi/strapi';

/**
 * Tools handed to `createAgent`, rebuilt per request from the CALLER's live ability. Every tool:
 *   1. validates the content-type uid against a live `api::*` allow-list,
 *   2. RBAC-checks the CALLER's ability via the content-manager permission-checker
 *      BEFORE touching the Document Service (which itself bypasses RBAC),
 *   3. returns compact JSON with long fields truncated, and
 *   4. returns STRUCTURED errors instead of throwing, so the model relays a clear
 *      message and does not blindly retry.
 *
 * PORTED SHAPE-FOR-SHAPE from the AI SDK's `tool()` onto LangChain's (research D7). Every
 * constitutional property of these tools is a property of the FUNCTION BODY, not of the SDK
 * wrapper — the uid allow-list, the permission check against the caller's live ability, the
 * compact/truncated JSON and the structured returns are all unchanged. Only the wrapper moved, so
 * Principle II is unaffected. The existing zod v4 schemas are reused verbatim: `tool()`'s installed
 * overloads accept `ZodObjectV4` directly, so there is no second zod copy and no schema rewrite.
 *
 * NO tool modifies content. `proposeChanges` records a pending plan; the sole write path is
 * `POST /change-sets/:id/apply`, driven by the user's click (FR-015).
 *
 * THERE IS NO `mode` PARAMETER. This is the single mode's tool set — exactly
 * `listContentTypes`, `searchEntries`, `getEntry`, `describePageStructure`, `proposeChanges`
 * (contracts/removals.md §1). `describePageStructure` is now UNCONDITIONAL: it used to be gated to
 * `layout` and `audit`, and FR-014 requires structure discovery in the only mode there is, so a
 * question about where a page's media or sections live is answerable with no mode switch.
 * `runQaScan` and `runSecurityAudit` are deleted outright (research D11).
 */

const MAX_FIELD_CHARS = 600;
const MAX_PAGE_SIZE = 50;

/**
 * Does this install offer a language-version choice at all? (005 FR-042, SC-018)
 *
 * MORE THAN ONE, not at least one: an install with exactly one locale is indistinguishable from one
 * with none, because there is nothing to choose between.
 *
 * Exported and pure so the suite can assert SC-018's tool-schema half without a Strapi runtime.
 * It is one line, and it is extracted rather than inlined precisely because SC-018 is a claim about
 * what the model is NOT shown — the kind of requirement that is invisible when it regresses, since
 * the extra parameter would simply start appearing and nothing would fail.
 */
export const offersLocaleChoice = (localeCodes: string[] | null | undefined): boolean =>
  Array.isArray(localeCodes) && localeCodes.length > 1;

type Action = 'read' | 'create' | 'update' | 'delete' | 'publish';

export interface BuildToolsOptions {
  /** The CALLER's CASL ability. Never cached across requests or users. */
  userAbility: unknown;
  /** The conversation a produced plan belongs to. */
  threadId?: string | null;
  ownerId?: number | null;
  /** Ordinals the user actually attached to THIS turn, for validating placements. */
  manifestOrdinals?: number[];
  /**
   * The install's language versions, or null on a single-locale install (005 FR-042, SC-018).
   *
   * ⚠ THIS IS WHAT MAKES THE CAPABILITY STRUCTURALLY INVISIBLE, and structure is the whole
   * mechanism — there is no prompt clause saying "do not mention locales". `buildTools` composes
   * the schemas PER REQUEST, so on an install with one locale the `locale` parameter is not in the
   * tool schema at all: there is no extra token, and nothing for the model to consider or get
   * wrong. Null and a one-locale list are the same input.
   */
  localeCodes?: string[] | null;
  /**
   * Whether to offer `getContentBriefing` at all (005 contracts/briefing-retrieval.md §2).
   *
   * OFFERED ONLY WHERE THE BRIEFING WAS ALREADY AMBIENT — `source` of `brief` or `both`, the feature
   * enabled, and at least one section stored. On `schema`, which is the default, nothing about the
   * briefing reaches the model today; putting a tool DEFINITION on every request would spend tokens
   * on every install that never opted in, straight through FR-027, SC-009 and SC-014.
   */
  offerBriefing?: boolean;
}

const toolsService = ({ strapi }: { strapi: Core.Strapi }) => ({
  buildTools({
    userAbility,
    threadId = null,
    ownerId = null,
    manifestOrdinals = [],
    localeCodes = null,
    offerBriefing = false,
  }: BuildToolsOptions) {
    const changeSets = () => strapi.plugin('ai-content-studio').service('change-sets');
    const contentBrief = () => strapi.plugin('ai-content-studio').service('content-brief');
    const locales = () => strapi.plugin('ai-content-studio').service('locales');

    const multiLocale = offersLocaleChoice(localeCodes);

    /**
     * The optional `locale` parameter, or nothing at all (FR-042).
     *
     * Spread into a schema rather than added conditionally afterwards, so the single-locale case
     * produces a schema that is byte-identical to the one this plugin shipped before language
     * versions existed.
     */
    const localeParam: { locale?: z.ZodOptional<z.ZodString> } = multiLocale
      ? {
          locale: z
            .string()
            .optional()
            .describe(
              `Which language version to read. One of: ${(localeCodes as string[]).join(', ')}. Omit for the default. If the requested version does not exist this returns locale_not_found — it NEVER returns a different version.`
            ),
        }
      : {};

    /**
     * Apply a requested locale to a Document Service call — and only where it means something.
     *
     * A `locale` on a content type that holds no language versions is silently dropped rather than
     * erroring: the model was offered the parameter for the install, not for the type, and refusing
     * the call would turn a harmless surplus argument into a failed turn.
     */
    const localeScope = (uid: string, locale: unknown): Record<string, string> =>
      multiLocale && typeof locale === 'string' && locale !== '' && locales().isLocalized(uid)
        ? { locale }
        : {};

    /**
     * FR-044: a requested language version that does not exist returns this, and NEVER a different
     * version. Answering from another locale is the failure this exists to prevent — it reads as a
     * successful answer about content that is not there.
     */
    const localeNotFound = (uid: string, locale: string) => ({
      ok: false as const,
      error: 'locale_not_found',
      message: `${uid} has no "${locale}" version of that entry. Tell the user that version does not exist — do not answer from another one.`,
    });
    const allowedUids = (): string[] =>
      Object.keys(strapi.contentTypes).filter((uid) => uid.startsWith('api::'));

    const ctOf = (uid: string): any => (strapi.contentTypes as Record<string, any>)[uid];
    const isSingle = (uid: string): boolean => ctOf(uid)?.kind === 'singleType';

    const checkerFor = (uid: string): any =>
      strapi
        .plugin('content-manager')
        .service('permission-checker')
        .create({ userAbility, model: uid });

    const can = (uid: string, action: Action, entity?: unknown): boolean => {
      const checker = checkerFor(uid);
      return Boolean(checker.can[action](entity));
    };

    const ensureAllowed = (uid: string) =>
      allowedUids().includes(uid)
        ? null
        : {
            ok: false as const,
            error: 'invalid_content_type',
            message: `Unknown or disallowed content type "${uid}". Call listContentTypes for valid uids.`,
          };

    const denied = (action: Action, uid: string) => ({
      ok: false as const,
      error: 'permission_denied',
      message: `Your account does not have permission to ${action} ${uid}.`,
    });

    const truncate = (v: unknown): unknown =>
      typeof v === 'string' && v.length > MAX_FIELD_CHARS
        ? `${v.slice(0, MAX_FIELD_CHARS)}… [truncated ${v.length - MAX_FIELD_CHARS} chars]`
        : v;

    const compact = (entry: any): unknown => {
      if (!entry || typeof entry !== 'object') {
        return entry;
      }
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(entry)) {
        out[k] = truncate(val);
      }
      return out;
    };

    const docs = (uid: string): any => strapi.documents(uid as any);

    const listContentTypes = tool(
      async () => ({
        ok: true,
        contentTypes: allowedUids().map((uid) => {
          const ct = ctOf(uid);
          return {
            uid,
            kind: ct.kind,
            displayName: ct.info?.displayName ?? uid,
            draftAndPublish: Boolean(ct.options?.draftAndPublish),
            attributes: Object.entries(ct.attributes ?? {}).map(([name, a]: [string, any]) => ({
              name,
              type: a.type,
              ...(a.required ? { required: true } : {}),
              ...(a.type === 'relation' ? { target: a.target, relation: a.relation } : {}),
              ...(a.type === 'enumeration' ? { enum: a.enum } : {}),
              ...(a.type === 'component' ? { component: a.component, repeatable: Boolean(a.repeatable) } : {}),
            })),
          };
        }),
      }),
      {
        name: 'listContentTypes',
        description:
          'List the editable website content types (uid, kind, display name, draft&publish flag, and a summary of attributes). Call this first to discover valid content-type uids.',
        schema: z.object({}),
      }
    );

    const searchEntries = tool(
      async ({ contentType, filters, page, pageSize, sort, status, locale }) => {
        const bad = ensureAllowed(contentType);
        if (bad) return bad;
        if (isSingle(contentType)) {
          return {
            ok: false,
            error: 'wrong_tool',
            message: `${contentType} is a single type; use getEntry (no documentId needed).`,
          };
        }
        if (!can(contentType, 'read')) return denied('read', contentType);
        const scope = localeScope(contentType, locale);
        const results = await docs(contentType).findMany({
          filters,
          sort,
          status,
          start: (page - 1) * pageSize,
          limit: pageSize,
          ...scope,
        });
        const list = Array.isArray(results) ? results : [];
        return {
          ok: true,
          page,
          pageSize,
          count: list.length,
          // FR-039: every result reports the version it actually returned, so the model never has
          // to infer which language it is reading.
          ...(multiLocale ? { locale: scope.locale ?? null } : {}),
          entries: list.map(compact),
        };
      },
      {
        name: 'searchEntries',
        description:
          'Search a COLLECTION type. Supports Strapi filter operators (e.g. { title: { $contains: "bath" } }). For single types, use getEntry instead.',
        schema: z.object({
          contentType: z.string().describe('Content-type uid, e.g. "api::blog-post.blog-post".'),
          filters: z.record(z.string(), z.any()).optional().describe('Strapi filters object.'),
          page: z.number().int().min(1).default(1),
          pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).default(10),
          sort: z.string().optional().describe('e.g. "createdAt:desc".'),
          status: z.enum(['draft', 'published']).optional(),
          ...localeParam,
        }),
      }
    );

    const getEntry = tool(
      async ({ contentType, documentId, populate, status, locale }) => {
        const bad = ensureAllowed(contentType);
        if (bad) return bad;
        if (!can(contentType, 'read')) return denied('read', contentType);
        const scope = localeScope(contentType, locale);
        let doc: any = null;
        if (isSingle(contentType)) {
          doc = await docs(contentType).findFirst({ populate, status, ...scope });
        } else if (documentId) {
          doc = await docs(contentType).findOne({ documentId, populate, status, ...scope });
        } else {
          return {
            ok: false,
            error: 'missing_documentId',
            message: 'documentId is required for collection types.',
          };
        }
        if (!doc) {
          /*
           * FR-044. A requested language version that resolved nothing is reported AS THAT, not as
           * a missing entry and never by falling back to another version — "no Ukrainian version
           * yet" and "no such entry" lead the editor to different next actions.
           */
          return scope.locale
            ? localeNotFound(contentType, scope.locale)
            : { ok: false, error: 'not_found' };
        }
        return {
          ok: true,
          ...(multiLocale ? { locale: (doc as { locale?: string }).locale ?? null } : {}),
          entry: compact(doc),
        };
      },
      {
        name: 'getEntry',
        description:
          'Fetch one entry. Collection types: pass documentId. Single types: omit documentId (the sole document is returned).',
        schema: z.object({
          contentType: z.string(),
          documentId: z.string().optional(),
          populate: z.union([z.literal('*'), z.array(z.string())]).optional(),
          status: z.enum(['draft', 'published']).optional(),
          ...localeParam,
        }),
      }
    );

    /**
     * Structure discovery (FR-014, FR-030): report WHERE media and links can go, so a placement
     * instruction can be resolved against slots that actually exist rather than guessed from field
     * names that belong to some other project.
     *
     * Read-only and RBAC-gated on `read`. Ambiguity is REPORTED, not resolved: if a page has
     * several media slots that could match "the hero image", all of them come back so the assistant
     * asks instead of choosing (FR-035).
     */
    const describePageStructure = tool(
      async ({ contentTypeUid, documentId, locale }) => {
        const bad = ensureAllowed(contentTypeUid);
        if (bad) return bad;
        if (!can(contentTypeUid, 'read')) return denied('read', contentTypeUid);

        const scope = localeScope(contentTypeUid, locale);
        let doc: any = null;
        if (isSingle(contentTypeUid)) {
          doc = await docs(contentTypeUid).findFirst({ populate: '*', ...scope });
        } else if (documentId) {
          doc = await docs(contentTypeUid).findOne({ documentId, populate: '*', ...scope });
        } else {
          return {
            ok: false,
            error: 'missing_documentId',
            message: 'documentId is required for collection types.',
          };
        }
        if (!doc) {
          // FR-044, as in getEntry: never answer a language-version question from another version.
          return scope.locale
            ? localeNotFound(contentTypeUid, scope.locale)
            : { ok: false, error: 'not_found' };
        }

        const componentAttributes = (component: string): Record<string, any> =>
          (strapi.components as Record<string, any>)[component]?.attributes ?? {};

        /** Summarize a slot's current value compactly — a media slot names its file, not its blob. */
        const describeValue = (attribute: any, value: unknown): string | null => {
          if (value === null || value === undefined) {
            return null;
          }
          if (attribute?.type === 'media') {
            const one = (v: any) => (v?.id ? `id ${v.id} — ${v.name ?? 'unnamed'}` : null);
            if (Array.isArray(value)) {
              return value.map(one).filter(Boolean).join(', ') || null;
            }
            return one(value);
          }
          if (attribute?.type === 'relation') {
            if (Array.isArray(value)) {
              return `${value.length} linked`;
            }
            return (value as any)?.documentId ? `linked ${(value as any).documentId}` : null;
          }
          return String(truncate(value));
        };

        /** Walk one component's attributes into a flat list of addressable slots. */
        const slotsOf = (attributes: Record<string, any>, prefix: string, value: any): any[] => {
          const slots: any[] = [];
          for (const [name, attribute] of Object.entries(attributes)) {
            const path = prefix ? `${prefix}.${name}` : name;
            const current = value?.[name];
            if (attribute.type === 'component') {
              if (attribute.repeatable) {
                const list = Array.isArray(current) ? current : [];
                slots.push({
                  field: path,
                  type: 'component-list',
                  component: attribute.component,
                  repeatable: true,
                  entries: list.length,
                });
                list.forEach((entry: any, i: number) => {
                  slots.push(...slotsOf(componentAttributes(attribute.component), `${path}[${i}]`, entry));
                });
              } else {
                slots.push(...slotsOf(componentAttributes(attribute.component), path, current));
              }
              continue;
            }
            if (attribute.type === 'dynamiczone') {
              const list = Array.isArray(current) ? current : [];
              list.forEach((entry: any, i: number) => {
                const component = entry?.__component;
                if (component) {
                  slots.push({
                    field: `${path}[${i}]`,
                    type: 'dynamic-zone-entry',
                    component,
                    repeatable: true,
                  });
                  slots.push(...slotsOf(componentAttributes(component), `${path}[${i}]`, entry));
                }
              });
              continue;
            }
            // Only slots a placement instruction can target are worth reporting.
            if (!['media', 'string', 'text', 'richtext', 'relation', 'enumeration', 'boolean'].includes(attribute.type)) {
              continue;
            }
            slots.push({
              field: path,
              type: attribute.type,
              ...(attribute.type === 'media' ? { multiple: attribute.multiple === true } : {}),
              ...(attribute.type === 'enumeration' ? { enum: attribute.enum } : {}),
              currentValue: describeValue(attribute, current),
            });
          }
          return slots;
        };

        const attributes = ctOf(contentTypeUid)?.attributes ?? {};
        const allSlots = slotsOf(attributes, '', doc);
        const label =
          ['title', 'name', 'heading', 'label', 'slug']
            .map((key) => doc[key])
            .find((v) => typeof v === 'string' && v.trim() !== '') ??
          ctOf(contentTypeUid)?.info?.displayName ??
          contentTypeUid;

        return {
          ok: true,
          contentTypeUid,
          documentId: doc.documentId,
          ...(multiLocale ? { locale: (doc as { locale?: string }).locale ?? null } : {}),
          documentLabel: label,
          slots: allSlots,
          mediaSlots: allSlots.filter((s) => s.type === 'media').map((s) => s.field),
          note:
            'Every candidate slot is listed. If more than one could match what the user described, ask which one rather than choosing.',
        };
      },
      {
        name: 'describePageStructure',
        description:
          "Describe a document's sections, components and the media / link / text slots inside them, with each slot's current value. Use this before proposing a placement so you target a slot that exists. Returns ALL candidate slots — if several could match what the user described, ask them which one; do not choose.",
        schema: z.object({
          contentTypeUid: z.string().describe('Content-type uid, e.g. "api::page.page".'),
          documentId: z.string().optional().describe('Omit for single types.'),
          ...localeParam,
        }),
      }
    );

    /**
     * The ONLY tool that can affect content — and it affects nothing until the user approves.
     *
     * `createEntry`, `updateEntry` and `publishEntry` were REMOVED (R1). They executed inside the
     * model's step loop, so "nothing is written without approval" depended on the model behaving.
     * Now the model can only persist a pending plan in the plugin's own table; the sole write path
     * is `POST /change-sets/:id/apply`, driven by the user's click.
     */
    const proposeChanges = tool(
      async ({ summary, items }) => {
        if (!threadId || !Number.isInteger(ownerId)) {
          return {
            ok: false,
            error: 'no_thread',
            message: 'This conversation has no thread, so a plan cannot be recorded.',
          };
        }
        return changeSets().createPending({
          threadId,
          ownerId: ownerId as number,
          userAbility,
          summary,
          items,
          manifestOrdinals,
        });
      },
      {
        name: 'proposeChanges',
        description:
          'Propose content changes for the user to approve. This writes NOTHING — it records a pending plan and returns it for review. Call it ONCE per request with every field you intend to change. Items the caller may not perform come back under `blocked`. After it returns, tell the user plainly that nothing has changed yet and that the plan is waiting for their approval in the panel.',
        schema: z.object({
          summary: z.string().describe('One short line describing the whole plan.'),
          items: z
            .array(
              z.object({
                operation: z
                  .enum(['create', 'update', 'publish', 'ingestAttachment'])
                  .describe('What this item does to the target.'),
                contentTypeUid: z.string().describe('Content-type uid, e.g. "api::page.page".'),
                documentId: z
                  .string()
                  .optional()
                  .describe('Target document. Omit for `create` and for single types.'),
                field: z
                  .string()
                  .optional()
                  .describe('Dotted field path, e.g. "hero.headline". Omit for `publish`.'),
                proposedValue: z
                  .any()
                  .optional()
                  .describe('The new value. Omit when using attachmentOrdinal.'),
                attachmentOrdinal: z
                  .number()
                  .int()
                  .optional()
                  .describe('For a media field fed by an attached file: its ordinal (#1 => 1). NEVER a media library id.'),
              })
            )
            .describe('Every change this plan should contain.'),
        }),
      }
    );

    /**
     * Retrieve one content type's stored briefing section, WITH ITS COVERAGE IN THE SAME PAYLOAD
     * (005 contracts/briefing-retrieval.md §3).
     *
     * WHY COVERAGE TRAVELS WITH THE PROSE. FR-009 requires it alongside, in one payload, precisely
     * so a section written from a fraction of a content type cannot read as a complete account.
     * Two calls would mean one of them gets skipped — and the one that would get skipped is the one
     * that makes the answer honest.
     *
     * PERMISSION AND VISIBILITY, stated plainly because this touches a NON-NEGOTIABLE principle.
     * The tool validates its uid against the live `api::*` allow-list, then applies EXACTLY the
     * visibility rule `content-brief.describeFor` applies today: shared by default, per-reader
     * filtered under `scopeToReader`. The invariant is that it returns NO MORE than the ambient
     * block it replaces already returned to the same caller.
     *
     * Principle II governs what the assistant can DO to content, and every content tool above still
     * RBAC-checks the caller before touching the Document Service — unchanged. The briefing is not
     * content: it is plugin-owned prose that feature 004 already decided is disclosed to every
     * account with chat access, argued in its own contract, stated above the Run button in
     * Settings, and switchable per install via `scopeToReader`. Making this tool STRICTER than the
     * block it replaces would silently remove briefing that installs receive today, which FR-033
     * and SC-009 forbid.
     */
    const getContentBriefing = tool(
      async ({ contentType }) => {
        const bad = ensureAllowed(contentType);
        if (bad) return bad;

        let retrieved: { section: any; coverage: any } | null = null;
        try {
          retrieved = await contentBrief().retrieve(contentType, userAbility);
        } catch {
          return {
            ok: false,
            error: 'brief_unavailable',
            message:
              'The stored briefing could not be read. Answer from the read tools instead, and say you could not reach the briefing.',
          };
        }

        if (!retrieved) {
          return {
            ok: false,
            error: 'no_section',
            message: `No briefing section is stored for ${contentType}. Read entries with the tools instead, and say the briefing does not cover it.`,
          };
        }

        return {
          ok: true,
          uid: contentType,
          text: retrieved.section.text,
          coverage: retrieved.coverage,
          note:
            'Briefing prose written from a sample at a point in time — not a live read. State that it came from the briefing and may be out of date. Where this and a tool result disagree, the tool result wins.',
        };
      },
      {
        name: 'getContentBriefing',
        description:
          "Retrieve the stored briefing section for ONE content type, with its coverage: how many entries it was written from, out of how many, when, and whether it is now out of date. Call this before making any statement that draws on the briefing. A section marked weak or out of date still comes back — say so when you rely on it.",
        schema: z.object({
          contentType: z.string().describe('Content-type uid, e.g. "api::page.page".'),
        }),
      }
    );

    /**
     * ONE tool set, for the one mode there is (contracts/removals.md §1).
     *
     * Nothing here adds an ability the caller's permissions do not already allow, because every
     * tool still RBAC-checks the caller per call (Principle II).
     *
     * `getContentBriefing` is composed in PER REQUEST rather than always present: an install that
     * never opted into the briefing must not pay for its schema on every turn (FR-027, SC-009).
     */
    return [
      listContentTypes,
      searchEntries,
      getEntry,
      describePageStructure,
      ...(offerBriefing ? [getContentBriefing] : []),
      proposeChanges,
    ];
  },
});

export default toolsService;
