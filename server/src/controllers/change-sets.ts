import { z } from 'zod';
import type { Core } from '@strapi/strapi';

/**
 * Change-plan routes. `apply` is the ONLY path in this plugin that mutates content, and it is
 * plain deterministic server code reached from the user's click — the model is not involved.
 *
 * Thin: the six-step gate lives in `services/change-sets`. Ownership is derived from the session,
 * and another user's plan answers 404 so ids are not enumerable.
 */

const applySchema = z.object({
  itemIds: z.array(z.string().min(1)).min(1),
  confirmDestructive: z.boolean().optional(),
  attachmentResolutions: z.record(z.string(), z.number().int()).optional(),
});

const NOT_FOUND = 'That change plan does not exist.';

/** Map a service error code onto an HTTP status. Messages are already user-facing (FR-053). */
const STATUS_FOR: Record<string, number> = {
  not_found: 404,
  not_pending: 409,
  expired: 409,
  no_items: 400,
  unknown_item: 400,
  permission_denied: 403,
  destructive_confirmation_required: 409,
  attachment_not_resolved: 409,
};

const changeSetsController = ({ strapi }: { strapi: Core.Strapi }) => {
  const changeSets = () => strapi.plugin('ai-content-studio').service('change-sets');

  const ownerOf = (ctx: any): number | null => {
    const id = ctx.state?.user?.id;
    return Number.isInteger(id) ? id : null;
  };

  const fail = (ctx: any, result: { error?: string; message?: string }) => {
    ctx.status = STATUS_FOR[result.error ?? ''] ?? 400;
    ctx.body = { error: result.error ?? 'bad_request', message: result.message ?? 'Request failed.' };
  };

  return {
    async findOne(ctx: any) {
      const ownerId = ownerOf(ctx);
      if (ownerId === null) {
        return ctx.unauthorized('Not authenticated.');
      }
      const set = await changeSets().getOwned(String(ctx.params.id), ownerId);
      if (!set) {
        return ctx.notFound(NOT_FOUND);
      }
      ctx.body = changeSets().present(set);
      return undefined;
    },

    async apply(ctx: any) {
      const ownerId = ownerOf(ctx);
      if (ownerId === null) {
        return ctx.unauthorized('Not authenticated.');
      }
      const parsed = applySchema.safeParse(ctx.request.body ?? {});
      if (!parsed.success) {
        return ctx.badRequest('Request body must be { itemIds: string[], confirmDestructive?: boolean }.');
      }
      const result = await changeSets().apply({
        changeSetId: String(ctx.params.id),
        ownerId,
        // The CALLER's live ability — re-derived per request, never cached (Constitution II).
        userAbility: ctx.state.userAbility,
        itemIds: parsed.data.itemIds,
        confirmDestructive: parsed.data.confirmDestructive ?? false,
        attachmentResolutions: parsed.data.attachmentResolutions ?? {},
      });
      if (!result.ok) {
        if (result.error === 'not_found') {
          return ctx.notFound(NOT_FOUND);
        }
        return fail(ctx, result);
      }
      ctx.body = result;
      return undefined;
    },

    async reject(ctx: any) {
      const ownerId = ownerOf(ctx);
      if (ownerId === null) {
        return ctx.unauthorized('Not authenticated.');
      }
      const result = await changeSets().reject({ changeSetId: String(ctx.params.id), ownerId });
      if (!result.ok) {
        if (result.error === 'not_found') {
          return ctx.notFound(NOT_FOUND);
        }
        return fail(ctx, result);
      }
      ctx.status = 204;
      return undefined;
    },
  };
};

export default changeSetsController;
