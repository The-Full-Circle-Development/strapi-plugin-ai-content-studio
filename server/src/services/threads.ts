import type { Core } from '@strapi/strapi';
import { UID } from '../content-types';
import type { AttachmentManifestEntry, ChatMode } from '../types';

/**
 * Owner-scoped conversation storage.
 *
 * THE isolation rule (FR-017, Constitution II): `ownerId` is taken from the authenticated caller
 * and NEVER from a request body. A thread id belonging to another user resolves as `null` here so
 * callers answer **404, not 403** — ids must not be enumerable. Super-admin gets NO exemption;
 * that is deliberate, stricter than the rest of Strapi, and documented in the README.
 *
 * Every read and write in this file therefore goes through `getOwnedThread`, or filters on
 * `ownerId` directly. There is no unscoped accessor to misuse.
 */

export interface ThreadSummary {
  id: string;
  title: string;
  mode: ChatMode;
  lastActivityAt: string;
  messageCount?: number;
}

export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant';
  sequence: number;
  parts: unknown[];
  attachmentManifest: AttachmentManifestEntry[] | null;
  interrupted: boolean;
  modeAtSend: ChatMode;
  changeSetId: string | null;
}

export interface AppendMessageInput {
  threadId: string;
  ownerId: number;
  role: 'user' | 'assistant';
  parts: unknown[];
  modeAtSend: ChatMode;
  attachmentManifest?: AttachmentManifestEntry[] | null;
  interrupted?: boolean;
  changeSetId?: string | null;
}

const DEFAULT_TITLE = 'New conversation';
const MAX_TITLE_CHARS = 60;

const threadsService = ({ strapi }: { strapi: Core.Strapi }) => {
  const docs = (uid: string): any => strapi.documents(uid as never);

  /**
   * Per-thread write serialization (edge case: the same user sends from two browser tabs of one
   * thread). Sequence allocation is read-then-write, so two concurrent appends could otherwise
   * both read the same max and produce a duplicate `sequence`, interleaving the replies. Chaining
   * per thread makes allocation atomic within this instance.
   */
  const chains = new Map<string, Promise<unknown>>();
  const serialize = <T>(threadId: string, work: () => Promise<T>): Promise<T> => {
    const prev = chains.get(threadId) ?? Promise.resolve();
    // `work` runs whether the previous append resolved or rejected — one failure must not
    // permanently wedge the thread.
    const result = prev.then(work, work);
    const tail = result.then(
      () => undefined,
      () => undefined
    );
    chains.set(threadId, tail);
    void tail.then(() => {
      // Only the last writer clears the entry, so the map does not grow per thread touched.
      if (chains.get(threadId) === tail) {
        chains.delete(threadId);
      }
    });
    return result;
  };

  const service = {
    /** Short, human title from a first message. Clamped to 60 chars (FR-019). */
    deriveTitle(text: string): string {
      const cleaned = (text ?? '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!cleaned) {
        return DEFAULT_TITLE;
      }
      if (cleaned.length <= MAX_TITLE_CHARS) {
        return cleaned;
      }
      const cut = cleaned.slice(0, MAX_TITLE_CHARS);
      const lastSpace = cut.lastIndexOf(' ');
      return `${(lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
    },

    async createThread({
      ownerId,
      mode = 'content',
      title,
    }: {
      ownerId: number;
      mode?: ChatMode;
      title?: string;
    }): Promise<ThreadSummary> {
      const now = new Date().toISOString();
      const created = await docs(UID.thread).create({
        data: {
          title: title ? service.deriveTitle(title) : DEFAULT_TITLE,
          ownerId,
          mode,
          lastActivityAt: now,
        },
      });
      return {
        id: created.documentId,
        title: created.title,
        mode: created.mode,
        lastActivityAt: created.lastActivityAt,
        messageCount: 0,
      };
    },

    /**
     * The ONLY way to reach a thread. Returns null when the thread does not exist OR belongs to
     * someone else — the caller cannot distinguish the two, which is the point. Callers answer
     * 404 in both cases.
     */
    async getOwnedThread(threadId: string, ownerId: number): Promise<any | null> {
      if (!threadId || typeof threadId !== 'string' || !Number.isInteger(ownerId)) {
        return null;
      }
      const thread = await docs(UID.thread).findOne({ documentId: threadId });
      if (!thread || thread.ownerId !== ownerId) {
        return null;
      }
      return thread;
    },

    /** Append one turn with a monotonic per-thread `sequence`. Also bumps last activity. */
    async appendMessage(input: AppendMessageInput): Promise<StoredMessage | null> {
      const { threadId, ownerId } = input;
      return serialize(threadId, async () => {
        const thread = await service.getOwnedThread(threadId, ownerId);
        if (!thread) {
          return null;
        }

        const last = await docs(UID.message).findMany({
          filters: { thread: { documentId: threadId } },
          sort: 'sequence:desc',
          limit: 1,
          fields: ['sequence'],
        });
        const nextSequence = Number(last?.[0]?.sequence ?? 0) + 1;

        const created = await docs(UID.message).create({
          data: {
            thread: threadId,
            role: input.role,
            sequence: nextSequence,
            parts: input.parts ?? [],
            attachmentManifest: input.attachmentManifest ?? null,
            interrupted: input.interrupted ?? false,
            modeAtSend: input.modeAtSend,
            ...(input.changeSetId ? { changeSet: input.changeSetId } : {}),
          },
        });

        const now = new Date().toISOString();
        // First user turn names the thread, unless the user already renamed it (FR-019).
        const firstText =
          input.role === 'user' && nextSequence === 1
            ? (input.parts ?? [])
                .map((p) => (p as { type?: string; text?: string }))
                .filter((p) => p?.type === 'text' && typeof p.text === 'string')
                .map((p) => p.text as string)
                .join(' ')
            : '';
        const autoTitle =
          firstText && (thread.title === DEFAULT_TITLE || !thread.title)
            ? service.deriveTitle(firstText)
            : null;

        await docs(UID.thread).update({
          documentId: threadId,
          data: { lastActivityAt: now, ...(autoTitle ? { title: autoTitle } : {}) },
        });

        return {
          id: created.documentId,
          role: created.role,
          sequence: created.sequence,
          parts: created.parts ?? [],
          attachmentManifest: created.attachmentManifest ?? null,
          interrupted: Boolean(created.interrupted),
          modeAtSend: created.modeAtSend,
          changeSetId: null,
        };
      });
    },

    /** Ordered messages for one thread. Owner-scoped; empty array is a valid history. */
    async listMessages(threadId: string): Promise<StoredMessage[]> {
      const rows = await docs(UID.message).findMany({
        filters: { thread: { documentId: threadId } },
        sort: 'sequence:asc',
        populate: { changeSet: { fields: ['documentId'] } },
        limit: -1,
      });
      return (Array.isArray(rows) ? rows : []).map((m: any) => ({
        id: m.documentId,
        role: m.role,
        sequence: m.sequence,
        parts: Array.isArray(m.parts) ? m.parts : [],
        attachmentManifest: Array.isArray(m.attachmentManifest) ? m.attachmentManifest : null,
        interrupted: Boolean(m.interrupted),
        modeAtSend: m.modeAtSend,
        changeSetId: m.changeSet?.documentId ?? null,
      }));
    },

    /**
     * Thread + full history in the shape the chat UI replays (FR-016).
     *
     * Also reports two things the UI must say out loud:
     *   - `contextCondensed` — earlier detail was summarized rather than sent verbatim (FR-021);
     *   - `expiredAttachments` — files held in the browser that were never ingested, so the user
     *     can be told plainly and invited to re-attach (FR-038). Held bytes do not survive a
     *     reload by design, so a manifest ordinal is expired unless an applied change item
     *     recorded its ingestion.
     */
    async loadHistory(
      threadId: string,
      ownerId: number
    ): Promise<{
      id: string;
      title: string;
      mode: ChatMode;
      lastActivityAt: string;
      contextCondensed: boolean;
      messages: StoredMessage[];
      expiredAttachments: Array<{ messageId: string; ordinals: number[] }>;
    } | null> {
      const thread = await service.getOwnedThread(threadId, ownerId);
      if (!thread) {
        return null;
      }
      const messages = await service.listMessages(threadId);
      const ingested = await service.ingestedOrdinals(threadId);
      const expiredAttachments = messages
        .filter((m) => m.attachmentManifest && m.attachmentManifest.length > 0)
        .map((m) => ({
          messageId: m.id,
          ordinals: (m.attachmentManifest ?? [])
            .map((a) => a.ordinal)
            .filter((ordinal) => !ingested.has(ordinal)),
        }))
        .filter((entry) => entry.ordinals.length > 0);

      return {
        id: thread.documentId,
        title: thread.title,
        mode: thread.mode,
        lastActivityAt: thread.lastActivityAt,
        contextCondensed: Boolean(thread.contextSummary),
        messages,
        expiredAttachments,
      };
    },

    /** Ordinals in this thread whose files actually reached the Media Library. */
    async ingestedOrdinals(threadId: string): Promise<Set<number>> {
      const sets = await docs(UID.changeSet).findMany({
        filters: { thread: { documentId: threadId } },
        fields: ['items', 'status'],
        limit: -1,
      });
      const out = new Set<number>();
      for (const set of Array.isArray(sets) ? sets : []) {
        if (set.status !== 'applied' && set.status !== 'partially_applied') {
          continue;
        }
        for (const item of Array.isArray(set.items) ? set.items : []) {
          if (typeof item?.attachmentOrdinal === 'number' && item?.outcome?.state === 'applied') {
            out.add(item.attachmentOrdinal);
          }
        }
      }
      return out;
    },

    /** Bump `lastActivityAt` — used by apply / reject, which are not message appends. */
    async touchLastActivity(threadId: string, ownerId: number): Promise<void> {
      const thread = await service.getOwnedThread(threadId, ownerId);
      if (!thread) {
        return;
      }
      await docs(UID.thread).update({
        documentId: threadId,
        data: { lastActivityAt: new Date().toISOString() },
      });
    },

    /**
     * Append the approving user, the time, and the applied items to the thread, so the exchange
     * stays auditable in the history (FR-008) rather than living only in a transient HTTP reply.
     *
     * Stored as an ordinary assistant turn whose parts carry a typed apply report, which is what
     * lets a reload replay the outcome exactly as the user first saw it.
     */
    async recordApproval({
      threadId,
      ownerId,
      changeSetId,
      appliedAt,
      items,
    }: {
      threadId: string;
      ownerId: number;
      changeSetId: string;
      appliedAt: string;
      items: Array<{
        id: string;
        field: string | null;
        documentLabel: string;
        contentTypeUid: string;
        resultingState: string;
        outcome: { state: string; message?: string; oldValue?: unknown; newValue?: unknown } | null;
      }>;
    }): Promise<void> {
      await service.appendMessage({
        threadId,
        ownerId,
        role: 'assistant',
        modeAtSend: 'content',
        changeSetId,
        parts: [
          {
            type: 'data-apply-report',
            data: {
              changeSetId,
              approvedByUserId: ownerId,
              appliedAt,
              items: items.map((i) => ({
                id: i.id,
                field: i.field,
                documentLabel: i.documentLabel,
                contentTypeUid: i.contentTypeUid,
                resultingState: i.resultingState,
                state: i.outcome?.state ?? 'skipped',
                message: i.outcome?.message ?? null,
                oldValue: i.outcome?.oldValue ?? null,
                newValue: i.outcome?.newValue ?? null,
              })),
            },
          },
        ],
      });
    },

    /** Attach a produced plan to the message that produced it, so history replays the plan card. */
    async linkChangeSetToMessage(messageId: string, changeSetId: string): Promise<void> {
      if (!messageId || !changeSetId) {
        return;
      }
      await docs(UID.message).update({
        documentId: messageId,
        data: { changeSet: changeSetId },
      });
    },

    async setMode(threadId: string, ownerId: number, mode: ChatMode): Promise<void> {
      const thread = await service.getOwnedThread(threadId, ownerId);
      if (!thread || thread.mode === mode) {
        return;
      }
      await docs(UID.thread).update({ documentId: threadId, data: { mode } });
    },

    summarize(thread: any): ThreadSummary {
      return {
        id: thread.documentId,
        title: thread.title,
        mode: thread.mode,
        lastActivityAt: thread.lastActivityAt,
      };
    },
  };

  return service;
};

export default threadsService;
