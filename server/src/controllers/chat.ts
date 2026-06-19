import { convertToModelMessages, streamText, stepCountIs, type UIMessage } from 'ai';
import type { Core } from '@strapi/strapi';
import { ProviderConfigError } from '../services/registry';

const SYSTEM_PROMPT = `You are the Concept Bath content assistant, embedded in the Strapi admin panel.

You can inspect and edit the website's content using the provided tools. Guidelines:
- Use listContentTypes to discover valid content-type uids before guessing them.
- Before creating, updating, or publishing anything, confirm the exact content type and document
  with the user, and briefly summarize what you are about to change. Ask for explicit confirmation
  when a request is ambiguous or potentially destructive.
- Tools return structured results. If a tool returns "permission_denied", tell the user plainly that
  their account lacks that permission and do NOT retry the same operation.
- Keep answers concise. Reference entries by their title and documentId.`;

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

    const result = streamText({
      model,
      system: SYSTEM_PROMPT,
      messages: await convertToModelMessages(messages),
      tools,
      stopWhen: stepCountIs(8),
      onError({ error }) {
        // Server-side only. Never logs API keys.
        strapi.log.error('[ai-content-studio] stream error', error);
      },
    });

    // Take over the response so Koa does not serialize its own (empty) body and close the socket.
    ctx.respond = false;
    result.pipeUIMessageStreamToResponse(ctx.res, {
      onError(error: unknown) {
        if (error instanceof ProviderConfigError) {
          return error.message;
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
