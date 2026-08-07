import * as React from 'react';
import { useAuth } from '@strapi/strapi/admin';
import { adminFetch } from './useThreads';

/**
 * Attachments held in BROWSER memory until the user approves ingestion (FR-033).
 *
 * Ordinals are 1-based, stable for the conversation, and never reused after a removal — "image #1"
 * must keep meaning the same file for the whole conversation, or a placement instruction the model
 * already resolved would silently retarget (FR-034).
 *
 * Nothing here uploads. The bytes leave the browser only to stage a preview or to ingest after
 * approval, both of which are explicit user actions.
 */

export type IngestionState = 'held' | 'staged' | 'ingested' | 'discarded';
export type Validation = 'ok' | 'too-large' | 'over-budget' | 'rejected';

export interface HeldAttachment {
  ordinal: number;
  file: File;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  validation: Validation;
  validationMessage?: string;
  ingestionState: IngestionState;
  mediaId?: number;
}

export interface AttachmentLimits {
  sizeLimitBytes: number;
  totalBudgetBytes: number;
  acceptsAnyMimeType: boolean;
  blockedMimeTypes: string[];
}

export interface ManifestEntry {
  ordinal: number;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

const mb = (bytes: number) => Math.round(bytes / 1024 / 1024);

export function useAttachments(threadIdRef: React.MutableRefObject<string | null>) {
  const token = useAuth('AiContentStudioAttachments', (state) => state.token);
  const tokenRef = React.useRef<string | null>(token);
  React.useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  const [held, setHeld] = React.useState<HeldAttachment[]>([]);
  const [limits, setLimits] = React.useState<AttachmentLimits | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // The next ordinal only ever increases, so a removed ordinal is never handed out again.
  const nextOrdinal = React.useRef(1);

  React.useEffect(() => {
    if (!token) {
      return;
    }
    // Fetched once so the composer can refuse a file before the message is sent (FR-032).
    void adminFetch<AttachmentLimits>('/attachments/limits', tokenRef.current)
      .then(setLimits)
      .catch(() => setLimits(null));
  }, [token]);

  /** Validate and hold files. Rejections are reported per file, before anything is sent. */
  const addFiles = React.useCallback(
    (files: File[]) => {
      setError(null);
      setHeld((current) => {
        const sizeLimit = limits?.sizeLimitBytes ?? Number.POSITIVE_INFINITY;
        const budget = limits?.totalBudgetBytes ?? Number.POSITIVE_INFINITY;
        let usedBytes = current
          .filter((a) => a.validation === 'ok')
          .reduce((sum, a) => sum + a.sizeBytes, 0);

        const added: HeldAttachment[] = [];
        for (const file of files) {
          let validation: Validation = 'ok';
          let validationMessage: string | undefined;

          if (file.size > sizeLimit) {
            validation = 'too-large';
            validationMessage = `Larger than this project's upload limit of ${mb(sizeLimit)} MB.`;
          } else if (usedBytes + file.size > budget) {
            validation = 'over-budget';
            validationMessage = `Would exceed the ${mb(budget)} MB held per conversation.`;
          } else if (
            limits?.blockedMimeTypes?.length &&
            limits.blockedMimeTypes.includes(file.type)
          ) {
            validation = 'rejected';
            validationMessage = `This project does not accept ${file.type || 'this file type'}.`;
          }

          if (validation === 'ok') {
            usedBytes += file.size;
          }

          added.push({
            ordinal: nextOrdinal.current,
            file,
            filename: file.name,
            mimeType: file.type || 'application/octet-stream',
            sizeBytes: file.size,
            validation,
            validationMessage,
            ingestionState: 'held',
          });
          nextOrdinal.current += 1;
        }
        return [...current, ...added];
      });
    },
    [limits]
  );

  /** Remove one held file. Its ordinal is retired, never recycled. */
  const removeOrdinal = React.useCallback((ordinal: number) => {
    setHeld((current) => current.filter((a) => a.ordinal !== ordinal));
  }, []);

  /** Drop everything held — used when switching or starting a conversation. */
  const clear = React.useCallback(() => {
    setHeld([]);
    // Ordinals keep climbing within the panel session; a new conversation starts a new stream of
    // them, and the server only ever validates against the ordinals of the turn being sent.
  }, []);

  /** The valid files, in ordinal order. These are what a message actually carries. */
  const sendable = React.useMemo(
    () => held.filter((a) => a.validation === 'ok').sort((a, b) => a.ordinal - b.ordinal),
    [held]
  );

  const manifest = React.useMemo<ManifestEntry[]>(
    () =>
      sendable.map(({ ordinal, filename, mimeType, sizeBytes }) => ({
        ordinal,
        filename,
        mimeType,
        sizeBytes,
      })),
    [sendable]
  );

  const filesByOrdinal = React.useMemo<Record<number, File>>(
    () => Object.fromEntries(held.map((a) => [a.ordinal, a.file])),
    [held]
  );

  /**
   * Ingest specific ordinals — the moment a held file becomes a Media Library entry (FR-033).
   *
   * The sha-256 of the bytes is sent as the idempotency key, so approving twice or retrying after a
   * network error returns the existing entry instead of a second file (FR-037).
   */
  const ingestOrdinals = React.useCallback(
    async (ordinals: number[]): Promise<Record<string, number>> => {
      const threadId = threadIdRef.current;
      if (!threadId) {
        throw new Error('This conversation has not started yet.');
      }
      const wanted = held.filter((a) => ordinals.includes(a.ordinal) && a.validation === 'ok');
      const missing = ordinals.filter((o) => !wanted.some((a) => a.ordinal === o));
      if (missing.length > 0) {
        throw new Error(
          `Attachment${missing.length > 1 ? 's' : ''} ${missing
            .map((o) => `#${o}`)
            .join(', ')} ${missing.length > 1 ? 'are' : 'is'} no longer held. Re-attach and try again.`
        );
      }

      const form = new FormData();
      form.append('threadId', threadId);
      for (const attachment of wanted) {
        form.append(`attachment[${attachment.ordinal}]`, attachment.file, attachment.filename);
        const hash = await sha256(attachment.file);
        form.append(`idempotencyKey[${attachment.ordinal}]`, hash);
      }

      const result = await adminFetch<{
        ingested: Array<{ ordinal: number; mediaId: number; name: string; url: string; deduplicated: boolean }>;
      }>('/attachments/ingest', tokenRef.current, { method: 'POST', body: form });

      setHeld((current) =>
        current.map((a) => {
          const entry = result.ingested.find((i) => i.ordinal === a.ordinal);
          return entry ? { ...a, ingestionState: 'ingested' as IngestionState, mediaId: entry.mediaId } : a;
        })
      );

      return Object.fromEntries(result.ingested.map((i) => [String(i.ordinal), i.mediaId]));
    },
    [held, threadIdRef]
  );

  return {
    held,
    sendable,
    manifest,
    filesByOrdinal,
    limits,
    error,
    setError,
    addFiles,
    removeOrdinal,
    clear,
    ingestOrdinals,
  };
}

/** sha-256 of a file's bytes, as hex — the ingestion idempotency key. */
async function sha256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export default useAttachments;
