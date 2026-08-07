import { convertToModelMessages, streamText, stepCountIs, type UIMessage } from 'ai';
import { z } from 'zod';
import type { Core } from '@strapi/strapi';
import { ProviderConfigError } from '../services/registry';
import { CHAT_MODES } from '../types';

const SYSTEM_PROMPT = `You are the Concept Bath content assistant, embedded in the Strapi admin panel.

You can inspect and edit the website's content using the provided tools.

## Tools & discovery
- Use listContentTypes to discover valid content-type uids before guessing them.
- Tools return structured results. If a tool returns "permission_denied", tell the user plainly that
  their account lacks that permission and do NOT retry the same operation.

## Keep the user in the loop — never act silently
- For any multi-step task, first state a short plan of what you will do.
- Before a write (createEntry / updateEntry / publishEntry), say in one line what you are about to
  change. Ask for explicit confirmation when the request is ambiguous or potentially destructive.
- As you work, narrate each step ("Looking up the homepage…", "Updating the hero headline…") so the
  user can follow along — don't jump straight to the result with no context.
- After EACH write, report the outcome in plain language: the content type, the document (title +
  documentId), exactly which fields changed (old → new value), and whether the entry is a draft or
  published. If a write fails, say what failed and why.
- Never apply a change without telling the user what you did. Summarize every mutation, even small ones.

## Working with images the user attaches
- When the user attaches an image you can SEE it — describe or analyze it if asked.
- Each attached image is also uploaded to the media library; the user's message lists its media id,
  name, and url (e.g. "id 42: ..."). To set or REPLACE a content field's image, call updateEntry
  with that media id:
    - single media field (featuredImage, logo, avatar, afterImage, beforeImage): data: { <field>: <id> }
    - multiple media field (gallery, additionalImages): data: { <field>: [<id>, ...] }
  Easy / top-level media: blog-post.featuredImage, blog-author.avatar, contact-info.logo,
  header.logo, service.featuredImage & gallery, project.afterImage/beforeImage/additionalImages.
  Harder — media nested in a component (e.g. homepage or page hero.slides[].image): getEntry first,
  rebuild the whole component with the new image id, and send it WITHOUT component ids (Strapi
  recreates them). Tell the user this rebuilds the component.
- You may or may not be able to SEE the image (depends on the active model). If you cannot see it,
  you can still set/replace media fields using the provided media id — just tell the user you can't
  visually analyze the image with the current model.
- Always confirm the target field and document before replacing, then report what changed.

## Style
- Use Markdown (bold, lists, inline code) — it is rendered in the chat.
- Be concise. Reference entries by their title and documentId.`;

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

    const tools = plugin.service('tools').buildTools({ userAbility });

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

    // Image handling that works with ALL models:
    //  - Drop file parts from older turns so we don't re-send base64 every request.
    //  - Keep file parts on the last message ONLY if the active model accepts images; otherwise
    //    strip them too, so a non-vision model never receives an image (which would error). The
    //    media id is still in the message text, so "replace this media field" works on any model.
    const trimmed = messages.map((message, index) => {
      const keepFiles = index === messages.length - 1 && supportsVision;
      return keepFiles
        ? message
        : { ...message, parts: (message.parts ?? []).filter((part) => part.type !== 'file') };
    });

    const result = streamText({
      model,
      system: SYSTEM_PROMPT,
      messages: await convertToModelMessages(trimmed),
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
