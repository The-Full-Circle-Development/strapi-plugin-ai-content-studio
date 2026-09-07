import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Core } from '@strapi/strapi';
import { UID } from '../content-types';
import type { AttachmentManifestEntry } from '../types';

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
  /** Null for turns stored before instruction versioning existed (FR-019). */
  promptVersion: string | null;
  changeSetId: string | null;
}

export interface AppendMessageInput {
  threadId: string;
  ownerId: number;
  role: 'user' | 'assistant';
  parts: unknown[];
  attachmentManifest?: AttachmentManifestEntry[] | null;
  interrupted?: boolean;
  /** The InstructionSet.version this turn was produced under. Assistant turns only. */
  promptVersion?: string | null;
  changeSetId?: string | null;
}

const DEFAULT_TITLE = 'New conversation';
const MAX_TITLE_CHARS = 60;

/**
 * Condensing bounds (R9). Characters rather than tokens on purpose: a token count depends on the
 * provider's tokenizer, and branching on provider identity is exactly what Constitution III
 * forbids. ~4 chars per token makes this budget roughly 15k tokens of verbatim tail, which every
 * model in the curated lists accepts.
 */
const VERBATIM_BUDGET_CHARS = 60_000;
/** Always send at least this many recent turns, however long they are. */
const MIN_VERBATIM_TURNS = 4;
const CONDENSE_INPUT_CHARS = 24_000;

/** Plain text of a stored message, for budgeting and summarizing. */
const textOf = (message: StoredMessage): string =>
  (message.parts ?? [])
    .map((part) => {
      const p = part as { type?: string; text?: string };
      if (p?.type === 'text' && typeof p.text === 'string') {
        return p.text;
      }
      // Tool calls and apply reports matter for context but are cheap to reduce to their shape.
      return p?.type ? `[${p.type}]` : '';
    })
    .filter(Boolean)
    .join('\n');

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
      title,
    }: {
      ownerId: number;
      title?: string;
    }): Promise<ThreadSummary> {
      const now = new Date().toISOString();
      const created = await docs(UID.thread).create({
        data: {
          title: title ? service.deriveTitle(title) : DEFAULT_TITLE,
          ownerId,
          // `mode` is deliberately NOT passed: the column is vestigial and takes its existing
          // schema default (research D12).
          lastActivityAt: now,
        },
      });
      return {
        id: created.documentId,
        title: created.title,
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
            // `promptVersion` records WHICH RULES this turn was run under (FR-019). Null is the
            // honest value for anything that had none.
            promptVersion: input.promptVersion ?? null,
            // `modeAtSend` is deliberately NOT passed: the column is vestigial and takes its
            // existing schema default, so nothing is migrated and nothing breaks (research D12).
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
          promptVersion: created.promptVersion ?? null,
          changeSetId: null,
        };
      });
    },

    /**
     * The caller's own threads, most-recent-first (FR-018). Cursor is a `lastActivityAt` ISO
     * string, so paging is stable while new activity lands at the front.
     */
    async listThreads({
      ownerId,
      limit = 30,
      cursor,
    }: {
      ownerId: number;
      limit?: number;
      cursor?: string | null;
    }): Promise<{ threads: ThreadSummary[]; nextCursor: string | null }> {
      const clamped = Math.min(100, Math.max(1, Math.trunc(limit) || 30));
      const rows = await docs(UID.thread).findMany({
        filters: {
          ownerId,
          ...(cursor ? { lastActivityAt: { $lt: cursor } } : {}),
        },
        sort: 'lastActivityAt:desc',
        // One extra row tells us whether another page exists without a second count query.
        limit: clamped + 1,
      });
      const list = Array.isArray(rows) ? rows : [];
      const page = list.slice(0, clamped);
      const counts = await Promise.all(
        page.map((thread: any) =>
          docs(UID.message).count({ filters: { thread: { documentId: thread.documentId } } })
        )
      );
      return {
        threads: page.map((thread: any, i: number) => ({
          ...service.summarize(thread),
          messageCount: Number(counts[i] ?? 0),
        })),
        nextCursor: list.length > clamped ? page[page.length - 1]?.lastActivityAt ?? null : null,
      };
    },

    /** Rename. The user's title wins over the automatic one from then on (FR-019). */
    async renameThread(threadId: string, ownerId: number, title: string): Promise<ThreadSummary | null> {
      const thread = await service.getOwnedThread(threadId, ownerId);
      if (!thread) {
        return null;
      }
      const trimmed = (title ?? '').trim().slice(0, MAX_TITLE_CHARS);
      if (trimmed === '') {
        return service.summarize(thread);
      }
      const updated = await docs(UID.thread).update({
        documentId: threadId,
        data: { title: trimmed },
      });
      return service.summarize(updated);
    },

    /**
     * Delete a thread and everything belonging to it: messages, change sets, preview sessions and
     * their staged bytes (FR-022). Content and Media Library entries an APPLIED plan already
     * produced are deliberately left alone — deleting a conversation must not undo approved work.
     */
    async deleteThread(threadId: string, ownerId: number): Promise<boolean> {
      const thread = await service.getOwnedThread(threadId, ownerId);
      if (!thread) {
        return false;
      }
      const messages = await docs(UID.message).findMany({
        filters: { thread: { documentId: threadId } },
        fields: ['documentId'],
        limit: -1,
      });
      for (const message of Array.isArray(messages) ? messages : []) {
        await docs(UID.message).delete({ documentId: message.documentId });
      }
      await strapi.plugin('ai-content-studio').service('change-sets').deleteForThread(threadId);
      await docs(UID.thread).delete({ documentId: threadId });
      return true;
    },

    /**
     * Ordered messages for one thread. Owner-scoped; empty array is a valid history.
     *
     * `createdAt` is a secondary sort, not decoration: `appendMessage` serializes allocation per
     * thread within an instance, but a multi-instance deployment could still land two appends on the
     * same `sequence`. The tiebreaker means the two turns render in a stable, non-interleaved order
     * instead of arbitrarily — neither reply is lost or shuffled into the other.
     */
    async listMessages(threadId: string): Promise<StoredMessage[]> {
      const rows = await docs(UID.message).findMany({
        filters: { thread: { documentId: threadId } },
        sort: ['sequence:asc', 'createdAt:asc'],
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
        // Null for turns stored before this column existed — never backfilled with a guess.
        promptVersion: m.promptVersion ?? null,
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
        outcome: {
          state: string;
          message?: string;
          oldValue?: unknown;
          newValue?: unknown;
          /** Present only when the approve-and-publish action ran (FR-050). */
          publish?: { state: string; message?: string } | null;
        } | null;
      }>;
    }): Promise<void> {
      await service.appendMessage({
        threadId,
        ownerId,
        role: 'assistant',
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
                // Persisted on the thread, so a reload REPLAYS the publish outcome rather than
                // losing it to a toast (FR-050, US6-8).
                publish: i.outcome?.publish ?? null,
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

    /**
     * Context for the next model request (R9, FR-021).
     *
     * Recent turns go verbatim up to a character budget; everything older is replaced by a running
     * summary stored on the thread and refreshed when the tail grows past the budget. The request
     * NEVER fails because a thread got long, and the UI is told detail was condensed.
     *
     * The summary is produced by the ACTIVE provider, so no second provider is introduced
     * (Constitution III).
     */
    async buildContext(
      threadId: string,
      ownerId: number
    ): Promise<{ summary: string | null; messages: StoredMessage[]; condensed: boolean } | null> {
      const thread = await service.getOwnedThread(threadId, ownerId);
      if (!thread) {
        return null;
      }
      const all = await service.listMessages(threadId);

      // Walk backwards accumulating verbatim turns until the budget is spent.
      const verbatim: StoredMessage[] = [];
      let used = 0;
      for (let i = all.length - 1; i >= 0; i -= 1) {
        const size = textOf(all[i]).length;
        if (verbatim.length >= MIN_VERBATIM_TURNS && used + size > VERBATIM_BUDGET_CHARS) {
          break;
        }
        verbatim.unshift(all[i]);
        used += size;
      }

      const older = all.slice(0, all.length - verbatim.length);
      if (older.length === 0) {
        return { summary: thread.contextSummary ?? null, messages: verbatim, condensed: false };
      }

      // Reuse the stored summary when it already covers every condensed turn.
      const lastOlderId = older[older.length - 1].id;
      if (thread.contextSummary && thread.summarizedThroughMessageId === lastOlderId) {
        return { summary: thread.contextSummary, messages: verbatim, condensed: true };
      }

      const summary = await service.summarizeTurns(older, thread.contextSummary ?? null);
      if (summary) {
        await docs(UID.thread).update({
          documentId: threadId,
          data: { contextSummary: summary, summarizedThroughMessageId: lastOlderId },
        });
        return { summary, messages: verbatim, condensed: true };
      }

      // Summarizing failed (provider hiccup). Fall back to the previous summary if there is one,
      // and otherwise to the verbatim tail — degrade, never fail the request (FR-021, FR-052).
      return { summary: thread.contextSummary ?? null, messages: verbatim, condensed: true };
    },

    /** Condense older turns into a running summary with the active provider. Null on failure. */
    async summarizeTurns(older: StoredMessage[], previousSummary: string | null): Promise<string | null> {
      const transcript = older
        .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${textOf(m).slice(0, 2000)}`)
        .join('\n')
        .slice(0, CONDENSE_INPUT_CHARS);
      if (transcript.trim() === '') {
        return previousSummary;
      }
      try {
        /**
         * Condensing runs on the ACTIVE provider, so no second provider is introduced — and it now
         * goes through the LangChain model instance directly.
         *
         * This used to `await import('ai')` and call `generateText({ model })`. That broke the
         * moment `registry.getActiveModel()` started returning a `BaseChatModel`: the AI SDK cannot
         * accept a LangChain instance. It typechecked only because the service lookup is untyped,
         * and the failure would have been INVISIBLE — the catch below degrades to the verbatim tail,
         * so condensation would simply never have worked again.
         *
         * The static import also matters for the distribution: the dynamic `import('ai')` split the
         * server bundle into hash-named chunks, and a hashed filename churns the committed `dist/`
         * on every build.
         */
        const { model } = await strapi.plugin('ai-content-studio').service('registry').getActiveModel();
        const reply = await (model as BaseChatModel).invoke([
          new SystemMessage(
            'You compress a Strapi content-editing conversation into durable notes. Keep every concrete referent a later turn might need: content-type uids, documentIds, entry titles, field paths, values that were changed, decisions the user made, and anything still outstanding. Drop pleasantries and narration. No preamble — notes only, under 250 words.'
          ),
          new HumanMessage(
            previousSummary
              ? `Existing notes:\n${previousSummary}\n\nFold these newly-condensed turns into the notes:\n${transcript}`
              : `Condense these turns into notes:\n${transcript}`
          ),
        ]);
        const summary = reply.text.trim();
        return summary === '' ? previousSummary : summary;
      } catch (err) {
        strapi.log.warn(
          `[ai-content-studio] could not condense thread history: ${strapi
            .plugin('ai-content-studio')
            .service('redact')
            .describeError(err)}`
        );
        return null;
      }
    },

    summarize(thread: any): ThreadSummary {
      return {
        id: thread.documentId,
        title: thread.title,
        lastActivityAt: thread.lastActivityAt,
      };
    },
  };

  return service;
};

export default threadsService;
