import { z } from 'zod';
import type { Core } from '@strapi/strapi';

/**
 * Thread routes. Thin: all logic lives in `services/threads`.
 *
 * Two rules hold everywhere in this file:
 *   - the owner is `ctx.state.user.id`, never anything from the body or query;
 *   - a thread that is not the caller's answers **404**, never 403, so ids are not enumerable.
 *
 * Failures are actionable and never carry an internal error or credential (FR-053).
 */

/*
 * `mode` is gone from both bodies (contracts/removals.md §1). There is one mode, so a new
 * conversation takes no selection step and there is nothing to switch. An older client that still
 * sends `mode` is not rejected for it — the field is simply ignored, so a cached admin bundle keeps
 * working through the upgrade.
 */
const createSchema = z.object({}).passthrough();

const updateSchema = z.object({
  title: z.string().max(120),
});

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

/**
 * The Focus the editor is pointing at (005 contracts/situation-and-focus.md §1.2).
 *
 * `documentId` is optional because single types have none, and `locale` because most installs have
 * one. Neither is trusted: the uid is checked against the live allow-list, the caller's own
 * `can.read` is checked, and the document is resolved — all in the service, before anything is
 * written.
 */
const focusSchema = z.object({
  uid: z.string().min(1),
  documentId: z.string().min(1).optional(),
  locale: z.string().min(1).optional(),
});

const NOT_FOUND = 'That conversation does not exist.';

const threadsController = ({ strapi }: { strapi: Core.Strapi }) => {
  const threads = () => strapi.plugin('ai-content-studio').service('threads');

  const ownerOf = (ctx: any): number | null => {
    const id = ctx.state?.user?.id;
    return Number.isInteger(id) ? id : null;
  };

  return {
    async create(ctx: any) {
      const ownerId = ownerOf(ctx);
      if (ownerId === null) {
        return ctx.unauthorized('Not authenticated.');
      }
      const parsed = createSchema.safeParse(ctx.request.body ?? {});
      if (!parsed.success) {
        return ctx.badRequest('Invalid request body.');
      }
      const thread = await threads().createThread({ ownerId });
      ctx.status = 201;
      ctx.body = thread;
      return undefined;
    },

    async find(ctx: any) {
      const ownerId = ownerOf(ctx);
      if (ownerId === null) {
        return ctx.unauthorized('Not authenticated.');
      }
      const parsed = listSchema.safeParse(ctx.request.query ?? {});
      if (!parsed.success) {
        return ctx.badRequest('`limit` must be between 1 and 100.');
      }
      // Scoped to the caller. There is no way to ask for anyone else's list.
      ctx.body = await threads().listThreads({
        ownerId,
        limit: parsed.data.limit ?? 30,
        cursor: parsed.data.cursor ?? null,
      });
      return undefined;
    },

    async findOne(ctx: any) {
      const ownerId = ownerOf(ctx);
      if (ownerId === null) {
        return ctx.unauthorized('Not authenticated.');
      }
      const history = await threads().loadHistory(String(ctx.params.id), ownerId);
      if (!history) {
        return ctx.notFound(NOT_FOUND);
      }
      ctx.body = history;
      return undefined;
    },

    async update(ctx: any) {
      const ownerId = ownerOf(ctx);
      if (ownerId === null) {
        return ctx.unauthorized('Not authenticated.');
      }
      const parsed = updateSchema.safeParse(ctx.request.body ?? {});
      if (!parsed.success) {
        return ctx.badRequest('Provide a title.');
      }
      const id = String(ctx.params.id);
      const summary = await threads().renameThread(id, ownerId, parsed.data.title);

      if (!summary) {
        return ctx.notFound(NOT_FOUND);
      }
      ctx.body = summary;
      return undefined;
    },

    async delete(ctx: any) {
      const ownerId = ownerOf(ctx);
      if (ownerId === null) {
        return ctx.unauthorized('Not authenticated.');
      }
      const deleted = await threads().deleteThread(String(ctx.params.id), ownerId);
      if (!deleted) {
        return ctx.notFound(NOT_FOUND);
      }
      ctx.status = 204;
      return undefined;
    },

    /**
     * Set this conversation's Focus (005 FR-014, FR-017).
     *
     * ⚠ EVERY FAILURE PATH IS CHOSEN SO IT REVEALS NOTHING THE CALLER DID NOT ALREADY KNOW:
     *   - another user's thread -> 404, the same as a thread that does not exist;
     *   - a uid outside the allow-list -> 400, which says only that the identifier is not one this
     *     plugin handles;
     *   - a content type the caller may not read -> 403 naming the permission and NOT the entry.
     *     It cannot leak existence, because the check runs before anything is read;
     *   - an entry or a language version that does not resolve -> 404, distinguishing the two,
     *     because "no such entry" and "no Ukrainian version yet" lead to different next actions
     *     (FR-044) and neither discloses anything the caller could not already read.
     */
    async setFocus(ctx: any) {
      const ownerId = ownerOf(ctx);
      if (ownerId === null) {
        return ctx.unauthorized('Not authenticated.');
      }
      const parsed = focusSchema.safeParse(ctx.request.body ?? {});
      if (!parsed.success) {
        return ctx.badRequest('Provide { uid, documentId?, locale? }.');
      }

      const result = await threads().setFocus(
        String(ctx.params.id),
        ownerId,
        // The CALLER's live ability, never a cached or elevated one.
        ctx.state.userAbility,
        {
          uid: parsed.data.uid,
          documentId: parsed.data.documentId ?? null,
          locale: parsed.data.locale ?? null,
        }
      );

      if (result.ok) {
        ctx.body = { focus: result.focus };
        return undefined;
      }

      switch (result.error) {
        case 'not_found':
          return ctx.notFound(NOT_FOUND);
        case 'invalid_content_type':
          return ctx.badRequest('That is not a content type this plugin can focus.');
        case 'permission_denied':
          return ctx.forbidden('Your account does not have permission to read that content type.');
        case 'locale_not_found':
          return ctx.notFound('That entry has no version in the requested language.');
        default:
          return ctx.notFound('That entry does not exist.');
      }
    },

    /** Clear this conversation's Focus. Owner-scoped, and idempotent. */
    async clearFocus(ctx: any) {
      const ownerId = ownerOf(ctx);
      if (ownerId === null) {
        return ctx.unauthorized('Not authenticated.');
      }
      const cleared = await threads().clearFocus(String(ctx.params.id), ownerId);
      if (!cleared) {
        return ctx.notFound(NOT_FOUND);
      }
      ctx.body = { ok: true };
      return undefined;
    },
  };
};

export default threadsController;
