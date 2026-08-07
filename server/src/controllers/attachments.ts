import fs from 'node:fs/promises';
import type { Core } from '@strapi/strapi';

/**
 * Attachment limits and ingestion.
 *
 * `limits` lets the composer refuse a file BEFORE the message is sent, naming the real reason
 * (FR-032). `ingest` is the one route that adds a held file to the Media Library, and it is called
 * only after the user approves a plan containing ingestion or explicitly asks to upload (FR-033,
 * FR-039).
 */

/**
 * Read `attachment[<ordinal>]` files and `idempotencyKey[<ordinal>]` fields from a multipart body.
 * Koa-body hands over one file or an array per field, with either a temp path or a buffer.
 */
async function readMultipart(ctx: any): Promise<{
  files: Array<{ ordinal: number; filename: string; mimeType: string; bytes: Buffer; idempotencyKey?: string }>;
  error?: string;
}> {
  const raw = ctx.request?.files ?? {};
  const body = ctx.request?.body ?? {};
  const files: Array<{
    ordinal: number;
    filename: string;
    mimeType: string;
    bytes: Buffer;
    idempotencyKey?: string;
  }> = [];

  for (const [field, value] of Object.entries(raw)) {
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
        return { files: [], error: `Attachment #${ordinal} could not be read.` };
      }
      const key = body[`idempotencyKey[${ordinal}]`];
      files.push({
        ordinal,
        filename: String(file.originalFilename ?? file.name ?? `attachment-${ordinal}`),
        mimeType: String(file.mimetype ?? file.type ?? 'application/octet-stream'),
        bytes,
        idempotencyKey: typeof key === 'string' && key.trim() !== '' ? key.trim() : undefined,
      });
    }
  }
  return { files };
}

const attachmentsController = ({ strapi }: { strapi: Core.Strapi }) => {
  const attachments = () => strapi.plugin('ai-content-studio').service('attachments');
  const threads = () => strapi.plugin('ai-content-studio').service('threads');

  return {
    async limits(ctx: any) {
      ctx.body = attachments().getLimits();
      return undefined;
    },

    async ingest(ctx: any) {
      const ownerId = ctx.state?.user?.id;
      if (!Number.isInteger(ownerId)) {
        return ctx.unauthorized('Not authenticated.');
      }

      const threadId = (ctx.request.body ?? {}).threadId;
      if (typeof threadId !== 'string' || threadId.trim() === '') {
        return ctx.badRequest('`threadId` is required.');
      }
      // Ingestion is scoped to a conversation the caller owns — a foreign thread is a 404.
      const thread = await threads().getOwnedThread(threadId, ownerId);
      if (!thread) {
        return ctx.notFound('That conversation does not exist.');
      }

      const { files, error } = await readMultipart(ctx);
      if (error) {
        return ctx.badRequest(error);
      }
      if (files.length === 0) {
        return ctx.badRequest('No files were attached.');
      }

      const result = await attachments().ingest({
        threadId,
        // The CALLER's live ability; the Media Library create permission is checked before any
        // byte is written, so a caller without it writes nothing at all.
        userAbility: ctx.state.userAbility,
        files,
      });

      if (!result.ok) {
        ctx.status = result.error === 'permission_denied' ? 403 : 400;
        ctx.body = { error: result.error, message: result.message };
        return undefined;
      }
      ctx.body = { ingested: result.ingested };
      return undefined;
    },
  };
};

export default attachmentsController;
