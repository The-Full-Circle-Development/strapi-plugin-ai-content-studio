import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Core } from '@strapi/strapi';
import type { AttachmentManifestEntry, IngestedAttachment } from '../types';

/**
 * Deferred media ingestion.
 *
 * The old behaviour uploaded on send and pasted the resulting media ids into the message — which is
 * exactly what made deferral impossible and littered the Media Library with files from abandoned
 * conversations. Now bytes stay in the BROWSER, the model gets an ordinal manifest, and a file
 * enters the library only when the user approves a plan containing it or explicitly asks to upload
 * (FR-033).
 *
 * Two rules are non-negotiable here:
 *   - the caller's Media Library create permission is checked BEFORE any byte is written;
 *   - ingestion is idempotent on (threadId, ordinal, contentHash), so a retried approval or a
 *     network retry returns the existing entry rather than creating a second file (FR-037).
 */

const UPLOAD_CREATE_ACTION = 'plugin::upload.assets.create';

/**
 * Idempotency ledger, keyed `threadId:ordinal:contentHash` -> media id.
 *
 * Module-level so it survives the per-request service factory. In-process only, which is the right
 * scope: it exists to make a RETRY of the same approval a no-op, and a retry always lands within
 * one panel session. A cross-instance duplicate stays possible in principle and is bounded by the
 * fact that the user has to approve twice on two different instances.
 */
const ingestLedger = new Map<string, IngestedAttachment>();

export interface EffectiveLimits {
  sizeLimitBytes: number;
  totalBudgetBytes: number;
  acceptsAnyMimeType: boolean;
  blockedMimeTypes: string[];
}

const attachmentsService = ({ strapi }: { strapi: Core.Strapi }) => {
  const plugin = () => strapi.plugin('ai-content-studio');

  const service = {
    /**
     * The host's effective upload rules plus this plugin's per-conversation budget, so the composer
     * can reject a file BEFORE the message is sent, with the real reason (FR-032).
     *
     * Strapi's Media Library imposes no MIME allow-list by default, so "any type the Media Library
     * allows" means whatever the host's upload configuration accepts — the plugin adds no list of
     * its own.
     */
    getLimits(): EffectiveLimits {
      // `sizeLimit` is bytes in Strapi v5's upload config; it defaults to 200 MB.
      const configured = strapi.config.get('plugin::upload.sizeLimit', undefined) as unknown;
      const sizeLimitBytes =
        typeof configured === 'number' && Number.isFinite(configured) && configured > 0
          ? Math.trunc(configured)
          : 200 * 1024 * 1024;
      return {
        sizeLimitBytes,
        totalBudgetBytes: plugin().service('config').getAttachmentOptions().totalBudgetBytes,
        acceptsAnyMimeType: true,
        blockedMimeTypes: [],
      };
    },

    /** Validate a manifest from the client. Ordinals must be positive, unique, and within budget. */
    validateManifest(
      raw: unknown
    ): { ok: true; manifest: AttachmentManifestEntry[] } | { ok: false; message: string } {
      if (raw === null || raw === undefined) {
        return { ok: true, manifest: [] };
      }
      if (!Array.isArray(raw)) {
        return { ok: false, message: 'attachmentManifest must be an array.' };
      }
      const limits = service.getLimits();
      const manifest: AttachmentManifestEntry[] = [];
      const seen = new Set<number>();
      let total = 0;

      for (const item of raw) {
        const entry = item as Partial<AttachmentManifestEntry>;
        const ordinal = Number(entry?.ordinal);
        if (!Number.isInteger(ordinal) || ordinal < 1) {
          return { ok: false, message: 'Every attachment needs a positive whole-number ordinal.' };
        }
        if (seen.has(ordinal)) {
          return { ok: false, message: `Attachment ordinal #${ordinal} appears twice.` };
        }
        seen.add(ordinal);
        const sizeBytes = Number(entry?.sizeBytes ?? 0);
        if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
          return { ok: false, message: `Attachment #${ordinal} has an invalid size.` };
        }
        if (sizeBytes > limits.sizeLimitBytes) {
          return {
            ok: false,
            message: `Attachment #${ordinal} is larger than this project's upload limit of ${Math.round(
              limits.sizeLimitBytes / 1024 / 1024
            )} MB.`,
          };
        }
        total += sizeBytes;
        manifest.push({
          ordinal,
          filename: String(entry?.filename ?? `attachment-${ordinal}`).slice(0, 255),
          mimeType: String(entry?.mimeType ?? 'application/octet-stream').slice(0, 255),
          sizeBytes,
        });
      }

      if (total > limits.totalBudgetBytes) {
        return {
          ok: false,
          message: `These attachments total more than the ${Math.round(
            limits.totalBudgetBytes / 1024 / 1024
          )} MB held per conversation. Remove some and try again.`,
        };
      }
      return { ok: true, manifest: manifest.sort((a, b) => a.ordinal - b.ordinal) };
    },

    /**
     * Render the manifest into the text the model actually reads.
     *
     * This is what makes "image #1 to the hero" resolvable on ANY provider, including one that
     * cannot see the bytes at all (FR-034, FR-036) — the ordinal, not a library id, is the model's
     * handle on the file.
     */
    describeManifest(manifest: AttachmentManifestEntry[], supportsVision: boolean): string {
      if (manifest.length === 0) {
        return '';
      }
      const lines = manifest.map(
        (a) => `#${a.ordinal} ${a.filename} (${a.mimeType}, ${Math.max(1, Math.round(a.sizeBytes / 1024))} KB)`
      );
      const note = supportsVision
        ? ''
        : '\nThe active model cannot interpret these files. Say so, and place them using their names, types and the instruction.';
      return `\n\n[Attached, NOT in the Media Library — refer to them by ordinal and place them with "attachmentOrdinal":\n${lines.join(
        '\n'
      )}]${note}`;
    },

    /** Does the caller hold the Media Library create permission? */
    canIngest(userAbility: unknown): boolean {
      const ability = userAbility as { can?: (action: string) => boolean } | null;
      try {
        return Boolean(ability?.can?.(UPLOAD_CREATE_ACTION));
      } catch {
        return false;
      }
    },

    /**
     * Add approved files to the Media Library — the ONE moment a held file becomes a library entry.
     *
     * Permission is checked before the loop, so a caller without it writes nothing at all rather
     * than partially succeeding (FR-033, permission-denied path 5).
     */
    async ingest({
      threadId,
      userAbility,
      files,
    }: {
      threadId: string;
      userAbility: unknown;
      files: Array<{ ordinal: number; filename: string; mimeType: string; bytes: Buffer; idempotencyKey?: string }>;
    }): Promise<
      | { ok: true; ingested: IngestedAttachment[] }
      | { ok: false; error: 'permission_denied' | 'upload_failed' | 'too_large'; message: string }
    > {
      if (!service.canIngest(userAbility)) {
        return {
          ok: false,
          error: 'permission_denied',
          message: 'Your account cannot upload to the Media Library.',
        };
      }

      const limits = service.getLimits();
      const oversized = files.find((f) => f.bytes.length > limits.sizeLimitBytes);
      if (oversized) {
        return {
          ok: false,
          error: 'too_large',
          message: `"${oversized.filename}" is larger than this project's upload limit of ${Math.round(
            limits.sizeLimitBytes / 1024 / 1024
          )} MB.`,
        };
      }

      const ingested: IngestedAttachment[] = [];
      for (const file of files) {
        // The content hash IS the idempotency key when the client did not supply one, so the same
        // bytes for the same ordinal can never produce two entries.
        const contentHash =
          file.idempotencyKey ?? crypto.createHash('sha256').update(file.bytes).digest('hex');
        const key = `${threadId}:${file.ordinal}:${contentHash}`;

        const previous = ingestLedger.get(key);
        if (previous) {
          ingested.push({ ...previous, deduplicated: true });
          continue;
        }

        // Strapi's upload service streams from a filepath, so the bytes go to a temp file for the
        // duration of the call and are removed immediately afterwards, success or failure. By this
        // point the user has approved the ingestion, so the file is no longer "unapproved".
        let tempPath: string | null = null;
        try {
          tempPath = path.join(
            os.tmpdir(),
            `ai-studio-${crypto.randomUUID()}-${file.filename.replace(/[^\w.\-]/g, '_')}`
          );
          await fs.writeFile(tempPath, file.bytes);

          const uploaded = await strapi
            .plugin('upload')
            .service('upload')
            .upload({
              data: {},
              files: {
                filepath: tempPath,
                originalFilename: file.filename,
                mimetype: file.mimeType,
                size: file.bytes.length,
              },
            });

          const entry = (Array.isArray(uploaded) ? uploaded[0] : uploaded) as
            | { id?: number; name?: string; url?: string }
            | undefined;
          if (!entry?.id) {
            return {
              ok: false,
              error: 'upload_failed',
              message: `"${file.filename}" could not be added to the Media Library.`,
            };
          }

          const record: IngestedAttachment = {
            ordinal: file.ordinal,
            mediaId: entry.id,
            name: entry.name ?? file.filename,
            url: entry.url ?? '',
            deduplicated: false,
          };
          ingestLedger.set(key, record);
          ingested.push(record);
        } catch (err) {
          strapi.log.error(
            `[ai-content-studio] attachment ingestion failed: ${plugin().service('redact').describeError(err)}`
          );
          return {
            ok: false,
            error: 'upload_failed',
            // Actionable, and free of any internal error text (FR-053).
            message: `"${file.filename}" could not be added to the Media Library. Check that its type and size are allowed.`,
          };
        } finally {
          if (tempPath) {
            await fs.rm(tempPath, { force: true }).catch(() => undefined);
          }
        }
      }

      return { ok: true, ingested };
    },
  };

  return service;
};

export default attachmentsService;
