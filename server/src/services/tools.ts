import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { Core } from '@strapi/strapi';

/**
 * Content tools passed to `streamText`. Every tool:
 *   1. validates the content-type uid against a live `api::*` allow-list,
 *   2. RBAC-checks the CALLER's ability via the content-manager permission-checker
 *      BEFORE touching the Document Service (which itself bypasses RBAC),
 *   3. returns compact JSON with long fields truncated, and
 *   4. returns STRUCTURED errors instead of throwing, so the model relays a clear
 *      message and does not blindly retry.
 */

const MAX_FIELD_CHARS = 600;
const MAX_PAGE_SIZE = 50;

type Action = 'read' | 'create' | 'update' | 'delete' | 'publish';

const toolsService = ({ strapi }: { strapi: Core.Strapi }) => ({
  buildTools({ userAbility }: { userAbility: unknown }): ToolSet {
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

    const createEntry = tool({
      description:
        'Create a new entry (saved as a draft for draft&publish content types). Provide the fields in `data`.',
      inputSchema: z.object({
        contentType: z.string(),
        data: z.record(z.string(), z.any()),
      }),
      execute: async ({ contentType, data }) => {
        const bad = ensureAllowed(contentType);
        if (bad) return bad;
        if (!can(contentType, 'create')) return denied('create', contentType);
        const created = await docs(contentType).create({ data });
        return { ok: true, entry: compact(created) };
      },
    });

    const updateEntry = tool({
      description:
        'Update an entry. Collection types: pass documentId. Single types: omit documentId (the sole document is updated).',
      inputSchema: z.object({
        contentType: z.string(),
        documentId: z.string().optional(),
        data: z.record(z.string(), z.any()),
      }),
      execute: async ({ contentType, documentId, data }) => {
        const bad = ensureAllowed(contentType);
        if (bad) return bad;
        if (!can(contentType, 'update')) return denied('update', contentType);
        let targetId = documentId;
        if (isSingle(contentType)) {
          const sole = await docs(contentType).findFirst({});
          targetId = sole?.documentId;
        }
        if (!targetId) {
          return {
            ok: false,
            error: 'missing_documentId',
            message: 'documentId is required (or the single type has not been created yet).',
          };
        }
        const updated = await docs(contentType).update({ documentId: targetId, data });
        return { ok: true, entry: compact(updated) };
      },
    });

    const publishEntry = tool({
      description: 'Publish an entry (only for content types that use draft & publish).',
      inputSchema: z.object({
        contentType: z.string(),
        documentId: z.string().optional(),
      }),
      execute: async ({ contentType, documentId }) => {
        const bad = ensureAllowed(contentType);
        if (bad) return bad;
        if (!ctOf(contentType).options?.draftAndPublish) {
          return {
            ok: false,
            error: 'not_publishable',
            message: `${contentType} does not use draft & publish, so it cannot be published.`,
          };
        }
        if (!can(contentType, 'publish')) return denied('publish', contentType);
        let targetId = documentId;
        if (isSingle(contentType)) {
          const sole = await docs(contentType).findFirst({});
          targetId = sole?.documentId;
        }
        if (!targetId) {
          return { ok: false, error: 'missing_documentId', message: 'documentId is required.' };
        }
        const published = await docs(contentType).publish({ documentId: targetId });
        return { ok: true, published: compact(published) };
      },
    });

    return {
      listContentTypes,
      searchEntries,
      getEntry,
      createEntry,
      updateEntry,
      publishEntry,
    };
  },
});

export default toolsService;
