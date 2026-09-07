import fs from 'node:fs/promises';
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
  /**
   * The Approve & Publish action (FR-044, FR-045). `publish: true` without `confirmPublish: true`
   * is refused with `409 publish_confirmation_required`, before anything is written.
   */
  publish: z.boolean().optional(),
  confirmPublish: z.boolean().optional(),
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
  publish_confirmation_required: 409,
};

/**
 * Read `attachment[<ordinal>]` parts out of a multipart request.
 *
 * Koa-body hands over either one file or an array per field, and either a temp path or an in-memory
 * buffer depending on the host's upload configuration — handle all four.
 */
async function readOrdinalFiles(
  ctx: any
): Promise<Array<{ ordinal: number; filename: string; mimeType: string; bytes: Buffer }>> {
  const files = ctx.request?.files ?? {};
  const out: Array<{ ordinal: number; filename: string; mimeType: string; bytes: Buffer }> = [];
  for (const [field, value] of Object.entries(files)) {
    const match = /^attachment\[(\d+)\]$/.exec(field);
    if (!match) {
      continue;
    }
    const ordinal = Number(match[1]);
    for (const file of (Array.isArray(value) ? value : [value]) as any[]) {
      if (!file) {
        continue;
      }
      let bytes: Buffer | null = null;
      if (Buffer.isBuffer(file.buffer)) {
        bytes = file.buffer;
      } else if (typeof file.filepath === 'string') {
        bytes = await fs.readFile(file.filepath);
      } else if (typeof file.path === 'string') {
        bytes = await fs.readFile(file.path);
      }
      if (!bytes) {
        continue;
      }
      out.push({
        ordinal,
        filename: String(file.originalFilename ?? file.name ?? `attachment-${ordinal}`),
        mimeType: String(file.mimetype ?? file.type ?? 'application/octet-stream'),
        bytes,
      });
    }
  }
  return out;
}

const changeSetsController = ({ strapi }: { strapi: Core.Strapi }) => {
  const changeSets = () => strapi.plugin('ai-content-studio').service('change-sets');
  const preview = () => strapi.plugin('ai-content-studio').service('preview');

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
        return ctx.badRequest(
          'Request body must be { itemIds: string[], confirmDestructive?: boolean, publish?: boolean, confirmPublish?: boolean }.'
        );
      }
      const result = await changeSets().apply({
        changeSetId: String(ctx.params.id),
        ownerId,
        // The CALLER's live ability — re-derived per request, never cached (Constitution II).
        userAbility: ctx.state.userAbility,
        itemIds: parsed.data.itemIds,
        confirmDestructive: parsed.data.confirmDestructive ?? false,
        attachmentResolutions: parsed.data.attachmentResolutions ?? {},
        publish: parsed.data.publish ?? false,
        confirmPublish: parsed.data.confirmPublish ?? false,
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

    /**
     * Create a preview session — multipart, so held attachment bytes can be staged and the
     * proposed image renders (FR-013). Creating a preview writes NO content (FR-015).
     *
     * A missing preview target answers 409 `preview_not_configured` with `fallback: 'field-diff'`,
     * which is the contracted way the panel learns to show the in-panel comparison instead. It
     * never blocks approval (FR-014).
     */
    async preview(ctx: any) {
      const ownerId = ownerOf(ctx);
      if (ownerId === null) {
        return ctx.unauthorized('Not authenticated.');
      }
      const set = await changeSets().getOwned(String(ctx.params.id), ownerId);
      if (!set) {
        return ctx.notFound(NOT_FOUND);
      }
      if (set.status !== 'pending') {
        ctx.status = 409;
        ctx.body = {
          error: 'not_pending',
          message: `This plan was already ${String(set.status).replace('_', ' ')}, so it cannot be previewed.`,
        };
        return undefined;
      }

      const body = ctx.request.body ?? {};
      let files: Array<{ ordinal: number; filename: string; mimeType: string; bytes: Buffer }> = [];
      try {
        files = await readOrdinalFiles(ctx);
      } catch {
        return ctx.badRequest('Could not read the attached files.');
      }

      const result = await preview().createSession({
        changeSet: set,
        ownerId,
        targetContentTypeUid:
          typeof body.targetContentTypeUid === 'string' ? body.targetContentTypeUid : null,
        targetDocumentId: typeof body.targetDocumentId === 'string' ? body.targetDocumentId : null,
        files,
      });

      if (!result.ok) {
        ctx.status = 409;
        ctx.body = {
          error: result.error ?? 'preview_not_configured',
          message: result.message ?? 'Preview is unavailable. Showing the field comparison instead.',
          fallback: result.fallback ?? 'field-diff',
        };
        return undefined;
      }
      ctx.body = {
        sessionId: result.sessionId,
        token: result.token,
        previewUrl: result.previewUrl,
        expiresAt: result.expiresAt,
        stagedFiles: result.stagedFiles,
      };
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
