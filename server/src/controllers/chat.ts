import { convertToModelMessages, streamText, stepCountIs, type UIMessage } from 'ai';
import { z } from 'zod';
import type { Core } from '@strapi/strapi';
import { ProviderConfigError } from '../services/registry';
import { CHAT_MODES, type ChatMode } from '../types';

/**
 * Request body. `threadId` is REQUIRED: every turn belongs to a durable, owner-scoped conversation
 * (FR-016), and the thread is what makes the reply persist across a reload or a restart.
 * Ownership is checked against `ctx.state.user.id` — a thread id from another user is a 404.
 */
const bodySchema = z.object({
  threadId: z.string().min(1),
  mode: z.enum(CHAT_MODES).optional(),
  messages: z.array(z.any()),
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
    const { threadId, messages } = parsed.data as { threadId: string; mode?: string; messages: UIMessage[] };

    const ownerId = ctx.state?.user?.id;
    if (!Number.isInteger(ownerId)) {
      return ctx.unauthorized('Not authenticated.');
    }

    // Owner-scoped: a thread belonging to anyone else is indistinguishable from a missing one.
    const thread = await threads().getOwnedThread(threadId, ownerId);
    if (!thread) {
      return ctx.notFound('That conversation does not exist.');
    }
    /**
     * The mode travels with the request, is persisted on the thread so it survives a reload
     * (FR-028), and is recorded on each message as `modeAtSend` so history stays readable after a
     * switch (FR-030's sibling requirement in US5-5). A mode only ever NARROWS the tool set; it
     * can never grant a capability the caller lacks (FR-031).
     */
    const mode = (parsed.data.mode ?? thread.mode ?? 'content') as ChatMode;
    if (parsed.data.mode && parsed.data.mode !== thread.mode) {
      await threads().setMode(threadId, ownerId, mode);
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
      // Config / key problems happen BEFORE streaming -> ordinary HTTP error (no key leaked).
      if (err instanceof ProviderConfigError) {
        return ctx.badRequest(err.message, { code: err.code });
      }
      strapi.log.error('[ai-content-studio] failed to build AI model', err);
      return ctx.internalServerError('AI provider initialization failed.');
    }

    // Tool set is derived per request from (caller ability, mode). `audit` mode never builds
    // proposeChanges, so read-only is structural rather than a refusal at runtime (FR-029).
    const tools = plugin.service('tools').buildTools({
      userAbility,
      mode,
      threadId,
      ownerId,
    });

    // Debug flag: surface the real (redacted) provider error to the UI instead of a generic one.
    const showErrorDetails = Boolean(
      strapi.config.get('plugin::ai-content-studio.showProviderErrorDetails', false)
    );

    // Persist the user's turn BEFORE streaming, so a crash or a disconnect mid-generation still
    // leaves an honest record of what was asked.
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role === 'user') {
      await threads().appendMessage({
        threadId,
        ownerId,
        role: 'user',
        // File parts hold base64 data URLs — never persist them (data-model: `parts` stores no
        // attachment bytes). The text of the turn is what history needs.
        parts: (lastMessage.parts ?? []).filter((part: any) => part?.type !== 'file'),
        modeAtSend: mode,
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

    // Image handling that works with ALL models: keep file parts from the incoming last message
    // ONLY if the active model accepts images, so a non-vision model never receives an image
    // (which would error). Stored history never holds file parts, so nothing re-sends base64.
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
     * Stop must release the SERVER's work, not just the client's view (FR-025).
     *
     * The chat hook's `stop()` aborts the underlying fetch, which closes this request. Wiring an
     * AbortController to the Koa request lifecycle turns that into a real `abortSignal`, so the
     * provider call ends and no further tool step begins. Without it the server keeps working
     * unobserved: with the write tools gone a stray step can no longer touch content, but it can
     * still burn provider tokens and run reads.
     */
    const abort = new AbortController();
    let streamFinished = false;
    const turnStartedAt = new Date().toISOString();
    const onClientGone = () => {
      // `close` also fires after a NORMAL completion, so only a close before the stream finished
      // is a real stop.
      if (!streamFinished && !abort.signal.aborted) {
        abort.abort();
      }
    };
    ctx.req.once('close', onClientGone);
    ctx.req.once('aborted', onClientGone);

    const result = streamText({
      model,
      abortSignal: abort.signal,
      system: [
        plugin.service('prompt').build({ mode, supportsVision }),
        context?.summary
          ? `## Earlier in this conversation (condensed)\nThese notes replace older turns that were summarized to stay inside the model's context. Treat them as fact.\n\n${context.summary}`
          : null,
      ]
        .filter(Boolean)
        .join('\n\n'),
      messages: await convertToModelMessages(replayed),
      tools,
      stopWhen: stepCountIs(8),
      onError({ error }) {
        // Server-side only — redacted so a provider error that echoes a key/url can't leak it.
        strapi.log.error(`[ai-content-studio] stream error: ${redact().describeError(error)}`);
      },
      onAbort({ steps }) {
        strapi.log.info(
          `[ai-content-studio] generation stopped by the user after ${steps.length} step(s); no further step will run`
        );
      },
    });

    // Take over the response so Koa does not serialize its own (empty) body and close the socket.
    ctx.respond = false;
    result.pipeUIMessageStreamToResponse(ctx.res, {
      // Persistence mode: the response message gets an id and arrives in `onFinish` already in
      // the UI-part shape the chat replays, which is exactly what `chat-message.parts` stores.
      originalMessages: messages,
      async onFinish({ responseMessage, isAborted }) {
        streamFinished = true;
        try {
          const parts = [...(responseMessage?.parts ?? [])];

          if (isAborted) {
            /**
             * A stopped turn keeps its partial output, marked interrupted, and the thread stays
             * usable (FR-024). It must also say which changes had ALREADY been applied earlier in
             * the turn (FR-026) — the assistant cannot apply anything itself, but the user may
             * have approved a plan while this turn was still streaming, and silence about that
             * would be the one dishonest outcome here.
             */
            const applied = await plugin
              .service('change-sets')
              .appliedSince({ threadId, ownerId, since: turnStartedAt });
            parts.push({
              type: 'data-interrupted',
              data: { at: new Date().toISOString(), applied },
            } as never);
          }

          await threads().appendMessage({
            threadId,
            ownerId,
            role: 'assistant',
            parts,
            modeAtSend: mode,
            interrupted: isAborted,
          });
        } catch (err) {
          // Never let a persistence failure surface as a provider error to the user.
          strapi.log.error(
            `[ai-content-studio] failed to persist assistant turn: ${redact().describeError(err)}`
          );
        }
      },
      onError(error: unknown) {
        if (error instanceof ProviderConfigError) {
          return error.message;
        }
        if (showErrorDetails) {
          return `AI provider error: ${redact().describeError(error)}`;
        }
        return 'The AI provider returned an error. Please try again or check the provider settings.';
      },
      headers: {
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
    return undefined;
  },
});

export default chatController;
