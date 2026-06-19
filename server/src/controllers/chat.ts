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
    try {
      model = await strapi.plugin('ai-content-studio').service('registry').getActiveModel();
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

    const result = streamText({
      model,
      system: SYSTEM_PROMPT,
      messages: await convertToModelMessages(messages),
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
