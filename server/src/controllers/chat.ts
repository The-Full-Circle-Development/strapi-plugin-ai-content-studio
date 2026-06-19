import { convertToModelMessages, streamText, stepCountIs, type UIMessage } from 'ai';
import type { Core } from '@strapi/strapi';
import { ProviderConfigError } from '../services/registry';

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
 * Strip anything that could be an API key / token from a string before it is logged or surfaced.
 * Providers do not normally echo the key, but some put it in a request URL (?key=…) — redact
 * defensively so neither the server log nor the UI can ever leak it.
 */
function redactSecrets(text: string): string {
  return text
    .replace(/([?&](?:key|api[_-]?key|access_token)=)[^&\s"']+/gi, '$1[redacted]')
    .replace(/AIza[0-9A-Za-z\-_]{10,}/g, '[redacted]')
    .replace(/sk-(?:ant-)?[A-Za-z0-9\-_]{6,}/g, '[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9\-_.]+/gi, 'Bearer [redacted]');
}

/** Build a concise, key-free description of a provider / stream error. */
function describeProviderError(error: unknown): string {
  const e = error as { name?: string; statusCode?: number; message?: string };
  const parts: string[] = [];
  if (e?.name && e.name !== 'Error') parts.push(String(e.name));
  if (e?.statusCode) parts.push(`HTTP ${e.statusCode}`);
  if (e?.message) parts.push(String(e.message));
  else if (typeof error === 'string') parts.push(error);
  return redactSecrets(parts.join(' — ') || 'unknown error');
}

const chatController = ({ strapi }: { strapi: Core.Strapi }) => ({
  async chat(ctx: any) {
    const { messages } = (ctx.request.body ?? {}) as { messages?: UIMessage[] };
    if (!Array.isArray(messages)) {
      return ctx.badRequest('Request body must be { messages: UIMessage[] }.');
    }

    // Set by the admin auth strategy for type:'admin' routes — the CALLER's CASL ability.
    const userAbility = ctx.state.userAbility;

    let model;
    let supportsVision = false;
    try {
      const active = await strapi.plugin('ai-content-studio').service('registry').getActiveModel();
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

    const tools = strapi.plugin('ai-content-studio').service('tools').buildTools({ userAbility });

    // Debug flag: surface the real (redacted) provider error to the UI instead of a generic one.
    const showErrorDetails = Boolean(
      strapi.config.get('plugin::ai-content-studio.showProviderErrorDetails', false)
    );

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
        strapi.log.error(`[ai-content-studio] stream error: ${describeProviderError(error)}`);
      },
    });

    // Take over the response so Koa does not serialize its own (empty) body and close the socket.
    ctx.respond = false;
    result.pipeUIMessageStreamToResponse(ctx.res, {
      onError(error: unknown) {
        if (error instanceof ProviderConfigError) {
          return error.message;
        }
        if (showErrorDetails) {
          return `AI provider error: ${describeProviderError(error)}`;
        }
        return 'The AI provider returned an error. Please try again or check the provider settings.';
      },
      headers: {
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  },
});

export default chatController;
