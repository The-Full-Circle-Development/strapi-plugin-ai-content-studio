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
  };
};

export default threadsController;
