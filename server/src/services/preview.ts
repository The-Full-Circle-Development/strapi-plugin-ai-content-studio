import crypto from 'node:crypto';
import type { Core } from '@strapi/strapi';
import { UID } from '../content-types';
import type { ChangeItem, PreviewOverlay, PreviewTokenPayload, StagedFileMeta } from '../types';

/**
 * Live preview of a pending change set.
 *
 * The real front-end renders proposed values while the database is untouched (R2, FR-010). Nothing
 * here writes content, publishes, or queues a job (FR-015): a preview session is a row in this
 * plugin's own table plus a precomputed overlay, and the bytes of a not-yet-ingested attachment
 * live in THIS instance's memory — never in the Media Library (FR-013).
 *
 * Accepted v1 limitation (R2/R14): on a multi-instance deployment a staged-file request can land on
 * an instance without the bytes. It answers 404 and the preview shows the CURRENT image rather than
 * the proposed one — a degradation, never a broken page. Field overlays are unaffected because the
 * session lives in the database.
 */

export interface PreviewSessionResult {
  ok: boolean;
  error?: string;
  message?: string;
  fallback?: 'field-diff';
  sessionId?: string;
  token?: string;
  previewUrl?: string;
  expiresAt?: string;
  stagedFiles?: Array<{ ordinal: number; fileId: string }>;
}

interface StagedBytes {
  sessionId: string;
  fileId: string;
  ordinal: number;
  filename: string;
  mimeType: string;
  bytes: Buffer;
}

/**
 * Staged bytes, keyed `sessionId:fileId`. Module-level so it survives the per-request service
 * factory, and bounded by the same per-conversation budget the composer enforces.
 */
const stagedStore = new Map<string, StagedBytes>();

const previewService = ({ strapi }: { strapi: Core.Strapi }) => {
  const docs = (uid: string): any => strapi.documents(uid as never);
  const plugin = () => strapi.plugin('ai-content-studio');
  const options = () => plugin().service('config').getPreviewOptions();

  const stagedKey = (sessionId: string, fileId: string) => `${sessionId}:${fileId}`;

  /** Total staged bytes for one session — enforces `attachments.totalBudgetMb`. */
  const stagedBytesFor = (sessionId: string): number => {
    let total = 0;
    for (const entry of stagedStore.values()) {
      if (entry.sessionId === sessionId) {
        total += entry.bytes.length;
      }
    }
    return total;
  };

  const service = {
    /**
     * Resolve the front-end URL for a target document (T036).
     *
     * Answers `preview_not_configured` with `fallback: 'field-diff'` when preview is disabled, the
     * base URL is missing, or the type has no path pattern — approval is NEVER blocked by a
     * missing preview target (FR-014).
     */
    resolvePreviewUrl(
      contentTypeUid: string,
      doc: Record<string, unknown> | null
    ): { ok: true; url: string } | { ok: false; message: string } {
      const opts = options();
      if (!opts.enabled) {
        return {
          ok: false,
          message:
            'Front-end preview is not enabled for this project. Showing the field comparison instead.',
        };
      }
      const pattern = opts.paths[contentTypeUid];
      if (!pattern) {
        return {
          ok: false,
          message: `No preview target is configured for ${contentTypeUid}. Showing the field comparison instead.`,
        };
      }
      // Fill :token segments from the target document's own fields.
      const missing: string[] = [];
      const path = pattern.replace(/:([A-Za-z0-9_]+)/g, (_match: string, key: string) => {
        const value = doc?.[key];
        if (value === null || value === undefined || value === '') {
          missing.push(key);
          return '';
        }
        return encodeURIComponent(String(value));
      });
      if (missing.length > 0) {
        return {
          ok: false,
          message: `The preview path for ${contentTypeUid} needs ${missing
            .map((m) => `"${m}"`)
            .join(', ')}, which this entry does not have. Showing the field comparison instead.`,
        };
      }
      return { ok: true, url: `${opts.baseUrl}${path.startsWith('/') ? '' : '/'}${path}` };
    },

    /**
     * Precompute `{ [uid]: { [documentId]: { [dottedField]: value } } }` so the middleware applies
     * the overlay with one lookup and no per-request logic.
     *
     * A media field fed by an attachment becomes a media-shaped object with a NEGATIVE id and a
     * staged-file URL, so nothing downstream can mistake it for a library entry (R2).
     */
    buildOverlay(
      items: ChangeItem[],
      { sessionId, token, stagedByOrdinal }: { sessionId: string; token: string; stagedByOrdinal: Map<number, StagedFileMeta> }
    ): PreviewOverlay {
      const overlay: PreviewOverlay = {};
      for (const item of items) {
        // Only pending, permitted, field-bearing changes can be previewed.
        if (!item.field || !item.documentId || item.permissionVerdict === 'denied') {
          continue;
        }
        if (item.operation === 'publish') {
          continue;
        }
        let value: unknown = item.proposedValue;
        if (typeof item.attachmentOrdinal === 'number') {
          const staged = stagedByOrdinal.get(item.attachmentOrdinal);
          if (!staged) {
            // Without staged bytes the preview shows the current image (documented degradation).
            continue;
          }
          value = {
            // Negative on purpose — an id no Media Library entry can have.
            id: -staged.ordinal,
            documentId: `staged-${staged.fileId}`,
            name: staged.filename,
            mime: staged.mimeType,
            size: Math.round(staged.sizeBytes / 1024),
            url: `/ai-content-studio/preview/${sessionId}/file/${staged.fileId}?token=${encodeURIComponent(token)}`,
            provider: 'ai-content-studio-preview',
            alternativeText: staged.filename,
            formats: null,
          };
        }
        overlay[item.contentTypeUid] ??= {};
        overlay[item.contentTypeUid][item.documentId] ??= {};
        overlay[item.contentTypeUid][item.documentId][item.field] = value;
      }
      return overlay;
    },

    /**
     * Create a session for a pending change set. Optionally stages held attachment bytes so
     * proposed media renders. Writes NO content.
     */
    async createSession({
      changeSet,
      ownerId,
      targetContentTypeUid,
      targetDocumentId,
      files = [],
    }: {
      changeSet: any;
      ownerId: number;
      targetContentTypeUid?: string | null;
      targetDocumentId?: string | null;
      files?: Array<{ ordinal: number; filename: string; mimeType: string; bytes: Buffer }>;
    }): Promise<PreviewSessionResult> {
      const items: ChangeItem[] = Array.isArray(changeSet.items) ? changeSet.items : [];
      const previewable = items.filter((i) => i.field && i.documentId && i.permissionVerdict === 'allowed');
      const target = previewable.find(
        (i) =>
          (!targetContentTypeUid || i.contentTypeUid === targetContentTypeUid) &&
          (!targetDocumentId || i.documentId === targetDocumentId)
      );
      if (!target) {
        return {
          ok: false,
          error: 'preview_not_configured',
          fallback: 'field-diff',
          message: 'This plan has nothing a front-end page could render. Showing the field comparison instead.',
        };
      }

      // Read the target so the path pattern's :slug / :documentId segments can be filled.
      let doc: Record<string, unknown> | null = null;
      try {
        doc = await docs(target.contentTypeUid).findOne({ documentId: target.documentId as string });
      } catch {
        doc = null;
      }

      const resolved = service.resolvePreviewUrl(target.contentTypeUid, doc);
      if (!resolved.ok) {
        return {
          ok: false,
          error: 'preview_not_configured',
          fallback: 'field-diff',
          message: resolved.message,
        };
      }

      const opts = options();
      const sessionId = crypto.randomUUID();
      const expiresAtMs = Date.now() + opts.ttlMinutes * 60_000;
      const payload: PreviewTokenPayload = {
        sessionId,
        ownerId,
        changeSetId: changeSet.documentId,
        exp: Math.floor(expiresAtMs / 1000),
      };
      const token = plugin().service('crypto').signPreviewToken(payload);

      // Stage bytes, bounded by the per-conversation budget.
      const budget = plugin().service('config').getAttachmentOptions().totalBudgetBytes;
      const stagedMeta: StagedFileMeta[] = [];
      const stagedByOrdinal = new Map<number, StagedFileMeta>();
      let used = 0;
      for (const file of files) {
        if (used + file.bytes.length > budget) {
          strapi.log.warn(
            `[ai-content-studio] preview staging skipped attachment #${file.ordinal}: over the ${opts.ttlMinutes}-minute session's size budget`
          );
          continue;
        }
        const fileId = crypto.randomUUID();
        const meta: StagedFileMeta = {
          fileId,
          ordinal: file.ordinal,
          filename: file.filename,
          mimeType: file.mimeType,
          sizeBytes: file.bytes.length,
        };
        stagedStore.set(stagedKey(sessionId, fileId), {
          sessionId,
          fileId,
          ordinal: file.ordinal,
          filename: file.filename,
          mimeType: file.mimeType,
          bytes: file.bytes,
        });
        stagedMeta.push(meta);
        stagedByOrdinal.set(file.ordinal, meta);
        used += file.bytes.length;
      }

      const overlay = service.buildOverlay(items, { sessionId, token, stagedByOrdinal });
      const expiresAt = new Date(expiresAtMs).toISOString();
      const previewUrl = `${resolved.url}${resolved.url.includes('?') ? '&' : '?'}aiStudioPreview=${encodeURIComponent(token)}`;

      await docs(UID.previewSession).create({
        data: {
          changeSet: changeSet.documentId,
          ownerId,
          sessionId,
          overlay,
          stagedFiles: stagedMeta,
          expiresAt,
          targetUrl: resolved.url,
        },
      });

      return {
        ok: true,
        sessionId,
        token,
        previewUrl,
        expiresAt,
        stagedFiles: stagedMeta.map(({ ordinal, fileId }) => ({ ordinal, fileId })),
      };
    },

    /**
     * Look up a session for a VERIFIED token. Returns null unless the session exists, is not
     * revoked, has not expired, and its change set is still `pending`.
     */
    async resolveSession(payload: PreviewTokenPayload): Promise<{ overlay: PreviewOverlay } | null> {
      const rows = await docs(UID.previewSession).findMany({
        filters: { sessionId: payload.sessionId },
        populate: { changeSet: { fields: ['documentId', 'status'] } },
        limit: 1,
      });
      const session = Array.isArray(rows) ? rows[0] : null;
      if (!session || session.revokedAt) {
        return null;
      }
      if (session.ownerId !== payload.ownerId) {
        return null;
      }
      if (new Date(session.expiresAt).getTime() <= Date.now()) {
        return null;
      }
      // Valid only while the plan is still pending (FR-012).
      if (session.changeSet?.status !== 'pending' || session.changeSet?.documentId !== payload.changeSetId) {
        return null;
      }
      return { overlay: (session.overlay ?? {}) as PreviewOverlay };
    },

    /** Staged bytes for a verified token. Null on any miss — a miss degrades, never breaks. */
    async getStagedFile(
      payload: PreviewTokenPayload,
      fileId: string
    ): Promise<{ bytes: Buffer; mimeType: string; filename: string } | null> {
      const session = await service.resolveSession(payload);
      if (!session) {
        return null;
      }
      const entry = stagedStore.get(stagedKey(payload.sessionId, fileId));
      if (!entry) {
        // Held by a different instance, or dropped on restart (accepted limitation R14).
        return null;
      }
      return { bytes: entry.bytes, mimeType: entry.mimeType, filename: entry.filename };
    },

    /** Drop every staged byte of a session. */
    dropStagedFiles(sessionId: string): void {
      for (const key of [...stagedStore.keys()]) {
        if (stagedStore.get(key)?.sessionId === sessionId) {
          stagedStore.delete(key);
        }
      }
    },

    /** Revoke every session of a change set and drop their bytes (apply / reject / expiry). */
    async revokeForChangeSet(changeSetId: string): Promise<void> {
      const rows = await docs(UID.previewSession).findMany({
        filters: { changeSet: { documentId: changeSetId }, revokedAt: { $null: true } },
        fields: ['documentId', 'sessionId'],
        limit: -1,
      });
      const now = new Date().toISOString();
      for (const row of Array.isArray(rows) ? rows : []) {
        service.dropStagedFiles(row.sessionId);
        await docs(UID.previewSession).update({
          documentId: row.documentId,
          data: { revokedAt: now },
        });
      }
    },

    /** Delete sessions belonging to a deleted thread's change sets (FR-022). */
    async deleteForChangeSet(changeSetId: string): Promise<void> {
      const rows = await docs(UID.previewSession).findMany({
        filters: { changeSet: { documentId: changeSetId } },
        fields: ['documentId', 'sessionId'],
        limit: -1,
      });
      for (const row of Array.isArray(rows) ? rows : []) {
        service.dropStagedFiles(row.sessionId);
        await docs(UID.previewSession).delete({ documentId: row.documentId });
      }
    },

    /**
     * Sweep overdue sessions and free their memory (T091). Without this, staged bytes of a preview
     * nobody resolved would sit in the heap until restart.
     */
    async revokeExpired(): Promise<number> {
      const rows = await docs(UID.previewSession).findMany({
        filters: { revokedAt: { $null: true }, expiresAt: { $lt: new Date().toISOString() } },
        fields: ['documentId', 'sessionId'],
        limit: 200,
      });
      const list = Array.isArray(rows) ? rows : [];
      const now = new Date().toISOString();
      for (const row of list) {
        service.dropStagedFiles(row.sessionId);
        await docs(UID.previewSession).update({ documentId: row.documentId, data: { revokedAt: now } });
      }
      return list.length;
    },

    /** Bytes currently staged for a session — used by tests and diagnostics. */
    stagedSizeFor(sessionId: string): number {
      return stagedBytesFor(sessionId);
    },
  };

  return service;
};

export default previewService;
