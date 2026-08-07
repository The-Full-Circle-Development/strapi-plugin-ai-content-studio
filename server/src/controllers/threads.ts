import { z } from 'zod';
import type { Core } from '@strapi/strapi';
import { CHAT_MODES } from '../types';

/**
 * Thread routes. Thin: all logic lives in `services/threads`.
 *
 * Two rules hold everywhere in this file:
 *   - the owner is `ctx.state.user.id`, never anything from the body or query;
 *   - a thread that is not the caller's answers **404**, never 403, so ids are not enumerable.
 *
 * Failures are actionable and never carry an internal error or credential (FR-053).
 */

const createSchema = z.object({
  mode: z.enum(CHAT_MODES).optional(),
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
        return ctx.badRequest('Invalid request. `mode` must be one of content, layout, audit.');
      }
      const thread = await threads().createThread({ ownerId, mode: parsed.data.mode ?? 'content' });
      ctx.status = 201;
      ctx.body = thread;
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
  };
};

export default threadsController;
