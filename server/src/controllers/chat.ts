import { convertToModelMessages, streamText, stepCountIs, type UIMessage } from 'ai';
import { z } from 'zod';
import type { Core } from '@strapi/strapi';
import { ProviderConfigError } from '../services/registry';
import { CHAT_MODES } from '../types';

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
    const mode = (parsed.data.mode ?? thread.mode ?? 'content') as 'content' | 'layout' | 'audit';

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

    const result = streamText({
      model,
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
    });

    // Take over the response so Koa does not serialize its own (empty) body and close the socket.
    ctx.respond = false;
    result.pipeUIMessageStreamToResponse(ctx.res, {
      // Persistence mode: the response message gets an id and arrives in `onFinish` already in
      // the UI-part shape the chat replays, which is exactly what `chat-message.parts` stores.
      originalMessages: messages,
      async onFinish({ responseMessage, isAborted }) {
        try {
          await threads().appendMessage({
            threadId,
            ownerId,
            role: 'assistant',
            parts: responseMessage?.parts ?? [],
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
