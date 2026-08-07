import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { Core } from '@strapi/strapi';
import type { ChatMode } from '../types';

/**
 * Tools passed to `streamText`, rebuilt per request from (caller ability, mode). Every tool:
 *   1. validates the content-type uid against a live `api::*` allow-list,
 *   2. RBAC-checks the CALLER's ability via the content-manager permission-checker
 *      BEFORE touching the Document Service (which itself bypasses RBAC),
 *   3. returns compact JSON with long fields truncated, and
 *   4. returns STRUCTURED errors instead of throwing, so the model relays a clear
 *      message and does not blindly retry.
 *
 * NO tool in any mode modifies content. The write tools were removed; `proposeChanges` records a
 * pending plan and the user applies it from the panel (R1, FR-001).
 */

const MAX_FIELD_CHARS = 600;
const MAX_PAGE_SIZE = 50;

type Action = 'read' | 'create' | 'update' | 'delete' | 'publish';

export interface BuildToolsOptions {
  /** The CALLER's CASL ability. Never cached across requests or users. */
  userAbility: unknown;
  mode?: ChatMode;
  /** The conversation a produced plan belongs to. */
  threadId?: string | null;
  ownerId?: number | null;
  /** Ordinals the user actually attached to THIS turn, for validating placements. */
  manifestOrdinals?: number[];
}

const toolsService = ({ strapi }: { strapi: Core.Strapi }) => ({
  buildTools({
    userAbility,
    mode = 'content',
    threadId = null,
    ownerId = null,
    manifestOrdinals = [],
  }: BuildToolsOptions): ToolSet {
    const changeSets = () => strapi.plugin('ai-content-studio').service('change-sets');
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

    const listContentTypes = tool({
      description:
        'List the editable website content types (uid, kind, display name, draft&publish flag, and a summary of attributes). Call this first to discover valid content-type uids.',
      inputSchema: z.object({}),
      execute: async () => ({
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
    });

    const searchEntries = tool({
      description:
        'Search a COLLECTION type. Supports Strapi filter operators (e.g. { title: { $contains: "bath" } }). For single types, use getEntry instead.',
      inputSchema: z.object({
        contentType: z.string().describe('Content-type uid, e.g. "api::blog-post.blog-post".'),
        filters: z.record(z.string(), z.any()).optional().describe('Strapi filters object.'),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).default(10),
        sort: z.string().optional().describe('e.g. "createdAt:desc".'),
        status: z.enum(['draft', 'published']).optional(),
      }),
      execute: async ({ contentType, filters, page, pageSize, sort, status }) => {
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
        const results = await docs(contentType).findMany({
          filters,
          sort,
          status,
          start: (page - 1) * pageSize,
          limit: pageSize,
        });
        const list = Array.isArray(results) ? results : [];
        return {
          ok: true,
          page,
          pageSize,
          count: list.length,
          entries: list.map(compact),
        };
      },
    });

    const getEntry = tool({
      description:
        'Fetch one entry. Collection types: pass documentId. Single types: omit documentId (the sole document is returned).',
      inputSchema: z.object({
        contentType: z.string(),
        documentId: z.string().optional(),
        populate: z.union([z.literal('*'), z.array(z.string())]).optional(),
        status: z.enum(['draft', 'published']).optional(),
      }),
      execute: async ({ contentType, documentId, populate, status }) => {
        const bad = ensureAllowed(contentType);
        if (bad) return bad;
        if (!can(contentType, 'read')) return denied('read', contentType);
        let doc: any = null;
        if (isSingle(contentType)) {
          doc = await docs(contentType).findFirst({ populate, status });
        } else if (documentId) {
          doc = await docs(contentType).findOne({ documentId, populate, status });
        } else {
          return {
            ok: false,
            error: 'missing_documentId',
            message: 'documentId is required for collection types.',
          };
        }
        if (!doc) return { ok: false, error: 'not_found' };
        return { ok: true, entry: compact(doc) };
      },
    });

    /**
     * Layout support (FR-030): report WHERE media and links can go, so a placement instruction can
     * be resolved against slots that actually exist rather than guessed from field names that
     * belong to some other project.
     *
     * Read-only and RBAC-gated on `read`. Ambiguity is REPORTED, not resolved: if a page has
     * several media slots that could match "the hero image", all of them come back so the assistant
     * asks instead of choosing (FR-035).
     */
    const describePageStructure = tool({
      description:
        "Describe a document's sections, components and the media / link / text slots inside them, with each slot's current value. Use this before proposing a placement so you target a slot that exists. Returns ALL candidate slots — if several could match what the user described, ask them which one; do not choose.",
      inputSchema: z.object({
        contentTypeUid: z.string().describe('Content-type uid, e.g. "api::page.page".'),
        documentId: z.string().optional().describe('Omit for single types.'),
      }),
      execute: async ({ contentTypeUid, documentId }) => {
        const bad = ensureAllowed(contentTypeUid);
        if (bad) return bad;
        if (!can(contentTypeUid, 'read')) return denied('read', contentTypeUid);

        let doc: any = null;
        if (isSingle(contentTypeUid)) {
          doc = await docs(contentTypeUid).findFirst({ populate: '*' });
        } else if (documentId) {
          doc = await docs(contentTypeUid).findOne({ documentId, populate: '*' });
        } else {
          return {
            ok: false,
            error: 'missing_documentId',
            message: 'documentId is required for collection types.',
          };
        }
        if (!doc) return { ok: false, error: 'not_found' };

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
          documentLabel: label,
          slots: allSlots,
          mediaSlots: allSlots.filter((s) => s.type === 'media').map((s) => s.field),
          note:
            'Every candidate slot is listed. If more than one could match what the user described, ask which one rather than choosing.',
        };
      },
    });

    /**
     * The ONLY tool that can affect content — and it affects nothing until the user approves.
     *
     * `createEntry`, `updateEntry` and `publishEntry` were REMOVED (R1). They executed inside the
     * model's step loop, so "nothing is written without approval" depended on the model behaving.
     * Now the model can only persist a pending plan in the plugin's own table; the sole write path
     * is `POST /change-sets/:id/apply`, driven by the user's click.
     */
    const proposeChanges = tool({
      description:
        'Propose content changes for the user to approve. This writes NOTHING — it records a pending plan and returns it for review. Call it ONCE per request with every field you intend to change. Items the caller may not perform come back under `blocked`. After it returns, tell the user plainly that nothing has changed yet and that the plan is waiting for their approval in the panel.',
      inputSchema: z.object({
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
      execute: async ({ summary, items }) => {
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
    });

    /**
     * Read-only functional QA (FR-040..FR-045). Built only in `audit` mode.
     *
     * The description forbids speculative findings on purpose: a clean project must come back with
     * `findings: []` rather than plausible-sounding invention (FR-045).
     */
    const runQaScan = tool({
      description:
        'Run a READ-ONLY functional QA pass over the running content setup: required fields empty on existing entries, relations pointing at missing documents, media fields referencing missing files, values outside an enumeration, component usage that cannot render, single types never created, and published entries failing their own required fields. Changes nothing. Report ONLY what the result contains — never infer or invent a finding, and if `findings` is empty say the project looks clean for the checks that ran. ALWAYS repeat the `coverage` block: a pass that skipped types for permissions or ran out of budget is not a clean bill of health.',
      inputSchema: z.object({
        contentTypeUids: z
          .array(z.string())
          .optional()
          .describe('Limit the pass to these uids. Omit to inspect every type the caller can read.'),
        maxEntriesPerType: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe('Sample cap per content type. Default 50, max 200.'),
      }),
      execute: async ({ contentTypeUids, maxEntriesPerType }) => {
        const report = await strapi
          .plugin('ai-content-studio')
          .service('audit-qa')
          .run({ userAbility, contentTypeUids, maxEntriesPerType });
        return { ok: true, report };
      },
    });

    /**
     * Read-only security audit (FR-046..FR-050). Built only in `audit` mode, and gated inside on the
     * caller's LIVE `audit.run` ability rather than on a route policy, so the check is re-derived
     * per request (Constitution II).
     *
     * A refusal discloses NOTHING — no counts, no categories, no partial findings — because the
     * report is itself a map of the project's weak points (FR-048, spec decision D3).
     */
    const runSecurityAudit = tool({
      description:
        'Run a READ-ONLY security audit of the running configuration: public-role write grants, unauthenticated content-API endpoints, roles holding permissions beyond their stated scope, upload rules accepting executable or script types, unsafe debug settings, and secret-like values stored in content. Changes nothing. Requires the audit.run permission; without it this returns permission_denied and you must relay that refusal WITHOUT speculating about what it would have found. Secret values are already masked — report the mask and its location, never attempt to reconstruct a value. Remediations are advice: applying one goes through proposeChanges and the normal permission checks.',
      inputSchema: z.object({
        areas: z
          .array(z.enum(['permissions', 'endpoints', 'uploads', 'settings', 'content-secrets']))
          .optional()
          .describe('Limit the audit to these areas. Omit for all of them.'),
      }),
      execute: async ({ areas }) => {
        const ability = userAbility as { can?: (action: string) => boolean } | null;
        let permitted = false;
        try {
          permitted = Boolean(ability?.can?.('plugin::ai-content-studio.audit.run'));
        } catch {
          permitted = false;
        }
        if (!permitted) {
          // Deliberately bare: no counts, no categories, no hint of what exists.
          return {
            ok: false as const,
            error: 'permission_denied',
            message: 'Your account is not allowed to run the security audit.',
          };
        }
        const report = await strapi
          .plugin('ai-content-studio')
          .service('audit-security')
          .run({ areas, userAbility });
        return { ok: true, report };
      },
    });

    /**
     * The tool set per (caller ability, mode) — contracts/model-tools.md.
     *
     * | tool                  | content | layout | audit |
     * | listContentTypes      |    y    |   y    |   y   |
     * | searchEntries         |    y    |   y    |   y   |
     * | getEntry              |    y    |   y    |   y   |
     * | describePageStructure |    -    |   y    |   y   |
     * | proposeChanges        |    y    |   y    |   -   |
     * | runQaScan             |    -    |   -    |   y   |
     * | runSecurityAudit      |    -    |   -    |   y (permission-gated inside)
     *
     * `audit` mode simply never BUILDS proposeChanges, so read-only is structural — there is no
     * capability to refuse at runtime, which is the strongest form of FR-029. And a mode only ever
     * narrows: nothing below adds an ability the caller's permissions do not already allow, because
     * every tool still RBAC-checks the caller per call (FR-031).
     */
    const tools: ToolSet = { listContentTypes, searchEntries, getEntry };

    if (mode === 'layout' || mode === 'audit') {
      tools.describePageStructure = describePageStructure;
    }
    if (mode === 'content' || mode === 'layout') {
      tools.proposeChanges = proposeChanges;
    }
    if (mode === 'audit') {
      tools.runQaScan = runQaScan;
      // Built in audit mode for everyone; the audit.run check lives INSIDE, against the caller's
      // live ability, so a caller without it gets a refusal that discloses nothing (FR-048).
      tools.runSecurityAudit = runSecurityAudit;
    }
    return tools;
  },
});

export default toolsService;
