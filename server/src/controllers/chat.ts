import { createUIMessageStream, pipeUIMessageStreamToResponse, type UIMessage, type UIMessageChunk } from 'ai';
import { toBaseMessages, toUIMessageStream } from '@ai-sdk/langchain';
import { z } from 'zod';
import type { Core } from '@strapi/strapi';
import { ProviderConfigError } from '../services/registry';

/**
 * Request body. `threadId` is REQUIRED: every turn belongs to a durable, owner-scoped conversation
 * (FR-016), and the thread is what makes the reply persist across a reload or a restart.
 * Ownership is checked against `ctx.state.user.id` — a thread id from another user is a 404.
 *
 * `mode` is GONE from the schema (contracts/removals.md §1). There is one mode, so there is nothing
 * to select and nothing to send.
 */
const bodySchema = z.object({
  threadId: z.string().min(1),
  messages: z.array(z.any()),
  /**
   * Files the user attached to THIS turn. Metadata only — the bytes stay in the browser until the
   * user approves ingestion (FR-033). Validated in detail by the attachments service.
   */
  attachmentManifest: z.array(z.unknown()).optional(),
});

const chatController = ({ strapi }: { strapi: Core.Strapi }) => ({
  async chat(ctx: any) {
    const plugin = strapi.plugin('ai-content-studio');
    const redact = () => plugin.service('redact');
    const threads = () => plugin.service('threads');

    const parsed = bodySchema.safeParse(ctx.request.body ?? {});
    if (!parsed.success) {
      return ctx.badRequest('Request body must be { threadId: string, messages: UIMessage[] }.');
    }
    const { threadId, messages } = parsed.data as { threadId: string; messages: UIMessage[] };

    const ownerId = ctx.state?.user?.id;
    if (!Number.isInteger(ownerId)) {
      return ctx.unauthorized('Not authenticated.');
    }

    // Opportunistic, rate-limited, and never blocking: keeps expired plans and previews from
    // accumulating without owning a timer in the host process.
    void plugin.service('change-sets').sweepIfDue();

    // Owner-scoped: a thread belonging to anyone else is indistinguishable from a missing one.
    const thread = await threads().getOwnedThread(threadId, ownerId);
    if (!thread) {
      return ctx.notFound('That conversation does not exist.');
    }

    // Set by the admin auth strategy for type:'admin' routes — the CALLER's CASL ability.
    const userAbility = ctx.state.userAbility;

    let model;
    let supportsVision = false;
    try {
      const active = await plugin.service('registry').getActiveModel();
      model = active.model;
      supportsVision = active.supportsVision;
    } catch (err) {
      // All five ProviderConfigError codes happen BEFORE generation -> ordinary HTTP error naming
      // the provider, never the key (FR-010, contracts/chat-stream.md §8).
      if (err instanceof ProviderConfigError) {
        return ctx.badRequest(err.message, { code: err.code });
      }
      strapi.log.error('[ai-content-studio] failed to build AI model', err);
      return ctx.internalServerError('AI provider initialization failed.');
    }

    // Held attachments: metadata only, validated against the host's real upload rules so a bad
    // file is refused with the actual reason rather than failing later (FR-032).
    const manifestResult = plugin.service('attachments').validateManifest(parsed.data.attachmentManifest);
    if (!manifestResult.ok) {
      return ctx.badRequest(manifestResult.message);
    }
    const manifest = manifestResult.manifest;

    // Tool set is derived per request from the caller's live ability. There is no mode to narrow
    // it any more — this is the one tool set (contracts/removals.md §1).
    const tools = plugin.service('tools').buildTools({
      userAbility,
      threadId,
      ownerId,
      // Placements are validated against the ordinals actually attached to THIS turn.
      manifestOrdinals: manifest.map((a: { ordinal: number }) => a.ordinal),
    });

    // Debug flag: surface the real (redacted) provider error to the UI instead of a generic one.
    const showErrorDetails = Boolean(
      strapi.config.get('plugin::ai-content-studio.showProviderErrorDetails', false)
    );

    // Persist the user's turn BEFORE streaming, so a crash or a disconnect mid-generation still
    // leaves an honest record of what was asked.
    const lastMessage = messages[messages.length - 1];

    /**
     * The manifest reaches the model as TEXT on every provider, which is what makes
     * "image #1 to the hero" resolvable even on a model that cannot see the bytes (FR-034, FR-036).
     * The ordinal — never a Media Library id, which does not exist yet — is the model's handle.
     */
    const manifestNote = plugin.service('attachments').describeManifest(manifest, supportsVision);
    if (manifestNote && lastMessage?.role === 'user') {
      const parts = [...(lastMessage.parts ?? [])];
      const lastText = [...parts].reverse().find((part: any) => part?.type === 'text') as
        | { type: 'text'; text: string }
        | undefined;
      if (lastText) {
        lastText.text = `${lastText.text}${manifestNote}`;
      } else {
        parts.push({ type: 'text', text: manifestNote.trim() } as never);
      }
      lastMessage.parts = parts;
    }

    if (lastMessage?.role === 'user') {
      await threads().appendMessage({
        threadId,
        ownerId,
        role: 'user',
        // File parts hold base64 data URLs — never persist them (data-model: `parts` stores no
        // attachment bytes). The manifest is stored separately, so a restored thread can say which
        // held files were never ingested (FR-038).
        parts: (lastMessage.parts ?? []).filter((part: any) => part?.type !== 'file'),
        attachmentManifest: manifest.length > 0 ? manifest : null,
      });
    }

    /**
     * History comes from the SERVER, not the client (FR-020). The browser's list is a view; the
     * thread is the record. Rebuilding it here means a reload continues the same conversation, a
     * client cannot inject turns that were never sent, and context never crosses threads or users.
     *
     * Older turns are condensed rather than dropped, so a long thread degrades instead of failing
     * (FR-021).
     */
    const context = (await threads().buildContext(threadId, ownerId)) as {
      summary: string | null;
      messages: Array<{ id: string; role: 'user' | 'assistant'; parts: unknown[] }>;
      condensed: boolean;
    } | null;
    const history = context?.messages ?? [];

    /**
     * Image handling that works with ALL models (FR-006, FR-023): image bytes are dropped from the
     * outgoing message BEFORE `toBaseMessages` converts anything, whenever the active model is not
     * declared vision-capable. They never reach the provider, so a non-vision model cannot fail the
     * whole request on an image it did not want.
     *
     * The ordinal manifest still reaches the model as text (above), so placement by filename keeps
     * working on every provider. Stored history never holds file parts, so nothing re-sends base64.
     */
    const incomingFileParts =
      supportsVision && lastMessage?.role === 'user'
        ? (lastMessage.parts ?? []).filter((part: any) => part?.type === 'file')
        : [];

    const replayed = history.map((message, index) => ({
      id: message.id,
      role: message.role,
      parts:
        index === history.length - 1 && incomingFileParts.length > 0
          ? [...message.parts, ...incomingFileParts]
          : message.parts,
    })) as UIMessage[];

    /**
     * The install description (FR-027..FR-037), resolved per request and per account.
     *
     * `groundingEnabled` is the EFFECTIVE value from `config.isGroundingEnabled()` — the AND of the
     * deploy-time hard off-switch and the runtime toggle — never one of the two flags read directly
     * (contracts/install-description.md §7).
     */
    const groundingSvc = plugin.service('grounding');
    const groundingEnabled = await plugin.service('config').isGroundingEnabled();
    let readableUids: string[] = [];
    let schemaFingerprint = '';
    let install: { text: string; partial: boolean } | null = null;
    if (groundingEnabled) {
      try {
        readableUids = groundingSvc.readableUids(userAbility);
        schemaFingerprint = groundingSvc.schemaFingerprint();
        const description = groundingSvc.describe(userAbility);
        install = description ? { text: description.text, partial: description.partial } : null;
      } catch (err) {
        // Grounding is an enhancement, never a prerequisite: if it fails, the turn proceeds with
        // tool-based discovery instead of failing the request.
        strapi.log.warn(
          `[ai-content-studio] could not build the install description: ${redact().describeError(err)}`
        );
        install = null;
      }
    }

    const instructions = plugin.service('prompt').build({
      supportsVision,
      hasAttachments: manifest.length > 0,
      groundingEnabled,
      readableUids,
      schemaFingerprint,
      contextSummary: context?.summary ?? null,
      install,
    });

    /**
     * Stop must release the SERVER's work, not just the client's view (FR-025).
     *
     * The chat hook's `stop()` aborts the underlying fetch, which closes this request. Wiring an
     * AbortController to the Koa request lifecycle turns that into a real signal, so the provider
     * call ends and no further tool step begins.
     */
    const abort = new AbortController();
    let streamFinished = false;
    /**
     * A REAL stop, as distinct from a normal completion.
     *
     * `onFinish`'s `isAborted` cannot be used here: it is set only by an `{ type: 'abort' }` chunk,
     * and the bridge never emits one. So the interrupted branch reads this flag, maintained from the
     * Koa lifecycle (contracts/chat-stream.md §4).
     */
    let userStopped = false;
    const turnStartedAt = new Date().toISOString();
    const onClientGone = () => {
      // `close` also fires after a NORMAL completion, so only a close before the stream finished
      // is a real stop.
      if (!streamFinished && !abort.signal.aborted) {
        userStopped = true;
        abort.abort();
      }
    };
    ctx.req.once('close', onClientGone);
    ctx.req.once('aborted', onClientGone);

    let agentStream;
    try {
      agentStream = await plugin.service('agent').run({
        model,
        tools,
        systemPrompt: instructions.text,
        messages: await toBaseMessages(replayed),
        signal: abort.signal,
      });
    } catch (err) {
      strapi.log.error(`[ai-content-studio] failed to start generation: ${redact().describeError(err)}`);
      return ctx.internalServerError('AI generation could not be started.');
    }

    /** The client-facing text for a provider failure. Nothing credential-shaped, on any path. */
    const clientFacingError = (raw: unknown): string => {
      if (raw instanceof ProviderConfigError) {
        return raw.message;
      }
      if (showErrorDetails) {
        return `AI provider error: ${redact().describeError(raw)}`;
      }
      return 'The AI provider returned an error. Please try again or check the provider settings.';
    };

    /**
     * ⚠ THE MASK THAT ACTUALLY GUARDS THE CREDENTIAL PATH (FR-008, SC-009,
     * contracts/chat-stream.md §8).
     *
     * `createUIMessageStream`'s `onError` only fires for errors that ESCAPE to it, and the bridge
     * never lets one escape: on a provider failure it catches the throw itself and enqueues
     * `{ type: 'error', errorText: errorObj.message }` — the provider's RAW message, straight to the
     * browser, past every callback. Verified in the installed `@ai-sdk/langchain@2.0.285`
     * (`src/adapter.ts`, the `catch` block): the enqueue is UNCONDITIONAL.
     *
     * So redaction has to be a transform over the merged chunks, not a callback.
     *
     * The same `catch` block is also why a STOP would otherwise read as a failure. The contract
     * suggests suppressing that through the bridge's `onAbort`, but `onAbort` is `() => void` and
     * the error chunk is enqueued regardless of which callback ran — so it CANNOT suppress
     * anything. Dropping the chunk here is the only mechanism that works, and it is why a stop
     * shows as interrupted rather than as an error.
     *
     * `flush` is also where `data-interrupted` is written, because `writer.merge()` returns `void`
     * and cannot be awaited: the transform's flush is the one place that reliably runs after the
     * merged stream has drained and before `onFinish` assembles the message.
     */
    const guardChunks = new TransformStream<UIMessageChunk, UIMessageChunk>({
      transform(chunk, controller) {
        if (chunk.type === 'error') {
          if (userStopped || abort.signal.aborted) {
            // A stop is not a failure. Swallow the bridge's abort-shaped error chunk.
            return;
          }
          controller.enqueue({ ...chunk, errorText: clientFacingError(chunk.errorText) });
          return;
        }
        controller.enqueue(chunk);
      },
      async flush(controller) {
        if (!userStopped) {
          return;
        }
        /**
         * A stopped turn must say which changes had ALREADY been applied earlier in the turn
         * (FR-026). The assistant cannot apply anything itself, but the user may have approved a
         * plan while this turn was still streaming, and silence about that is the one dishonest
         * outcome available here.
         *
         * Written into the stream rather than spliced into the assembled parts array afterwards, so
         * one typed call reaches both the wire and the database — and the notice becomes visible
         * live rather than only on reload.
         */
        try {
          const applied = await plugin
            .service('change-sets')
            .appliedSince({ threadId, ownerId, since: turnStartedAt });
          controller.enqueue({
            type: 'data-interrupted',
            data: { at: new Date().toISOString(), applied },
          } as UIMessageChunk);
        } catch (err) {
          // Caught LOCALLY: a throw here would become an `{type:'error'}` chunk the editor sees,
          // which is exactly the "persistence failure surfacing as a provider error" the contract
          // forbids (§3 rule 1).
          strapi.log.error(
            `[ai-content-studio] could not report changes applied during the interrupted turn: ${redact().describeError(err)}`
          );
        }
      },
    });

    // Take over the response so Koa does not serialize its own (empty) body and close the socket.
    ctx.respond = false;
    pipeUIMessageStreamToResponse({
      response: ctx.res,
      headers: {
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
      stream: createUIMessageStream({
        /**
         * NOT OPTIONAL HERE (contracts/chat-stream.md §3 rule 5). The bridge emits a bare
         * `{ type: 'start' }` with no `messageId`, and the assembler only sets the message id when
         * the chunk carries one — so without this the stored turn gets `id: ''` and the browser is
         * sent no id at all.
         */
        originalMessages: messages,
        execute: ({ writer }) => {
          writer.merge(
            toUIMessageStream(agentStream, {
              // The SERVER-SIDE logger. Redacted, so a provider error that echoes a key or a
              // request URL cannot leak it into the host's logs.
              onError: (error: Error) => {
                strapi.log.error(`[ai-content-studio] stream error: ${redact().describeError(error)}`);
              },
              onAbort: () => {
                strapi.log.info(
                  '[ai-content-studio] generation stopped by the user; no further step will run'
                );
              },
            }).pipeThrough(guardChunks)
          );
        },
        /**
         * The client-facing mapper for anything that DOES escape to the SDK. Kept alongside the
         * transform above because they cover different paths and neither substitutes for the other.
         */
        onError: (error: unknown) => clientFacingError(error),
        async onFinish({ responseMessage }) {
          streamFinished = true;
          try {
            await threads().appendMessage({
              threadId,
              ownerId,
              role: 'assistant',
              parts: responseMessage?.parts ?? [],
              // WHICH RULES this turn was run under (FR-019).
              promptVersion: instructions.version,
              interrupted: userStopped,
            });
          } catch (err) {
            // Never let a persistence failure surface as a provider error to the user.
            strapi.log.error(
              `[ai-content-studio] failed to persist assistant turn: ${redact().describeError(err)}`
            );
          }
        },
      }),
    });
    return undefined;
  },
});

export default chatController;
