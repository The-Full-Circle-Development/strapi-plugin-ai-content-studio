import { z } from 'zod';
import type { Core } from '@strapi/strapi';

/**
 * The content-brief surface (contracts/content-brief.md §5).
 *
 * Both routes are SUPER-ADMIN ONLY, by route policy. Running a brief spends provider money and
 * reads across every content type the runner can see, so it belongs beside the provider settings
 * rather than beside the chat permission — and the status response includes generated prose about
 * content, which no narrower grant should hand out wholesale.
 *
 * Even so, neither handler trusts the route gate alone: the service filters sections by the
 * CALLER's live ability on the way out, so a super-admin with a restricted content scope still sees
 * only what they could read in the Content Manager (Principle II).
 */

const runSchema = z
  .object({
    /** Restrict a run to specific content types. Omitted, every readable one is regenerated. */
    uids: z.array(z.string().min(1)).optional(),
    /** Overrides the stored depth for THIS run only; the stored default is untouched. */
    depth: z.enum(['light', 'standard', 'deep']).optional(),
  })
  .strict();

const contentBriefController = ({ strapi }: { strapi: Core.Strapi }) => {
  const plugin = () => strapi.plugin('ai-content-studio');

  return {
    /** Run state, coverage, staleness and the estimated cost of a run, for the settings page. */
    async status(ctx: any) {
      ctx.body = await plugin().service('content-brief').status(ctx.state.userAbility);
    },

    /**
     * Start a run and return immediately.
     *
     * 202 rather than 200, and that is not decoration: the work has been ACCEPTED, not performed.
     * A `deep` run over a large install is minutes of sequential provider calls, so the response
     * only promises that a run started — the settings page polls `status` for the rest.
     */
    async run(ctx: any) {
      const parsed = runSchema.safeParse(ctx.request.body ?? {});
      if (!parsed.success) {
        return ctx.badRequest(
          parsed.error.issues[0]?.message ?? 'Invalid run payload.',
          { code: 'invalid_body' }
        );
      }

      const userId = ctx.state?.user?.id;
      if (!Number.isInteger(userId)) {
        return ctx.unauthorized('Not authenticated.');
      }

      const settings = await plugin().service('config').get();
      const depth = parsed.data.depth ?? settings.contentBrief.depth;

      const result = await plugin().service('content-brief').startRun({
        userAbility: ctx.state.userAbility,
        userId,
        depth,
        uids: parsed.data.uids,
      });

      if (!result.ok) {
        // `already_running` is a CONFLICT, not a bad request: the payload was fine, the state was
        // not, and the caller's correct response is to poll rather than to fix anything.
        if (result.error === 'already_running') {
          return ctx.conflict(result.message, { code: result.error });
        }
        return ctx.badRequest(result.message, { code: result.error });
      }

      ctx.status = 202;
      ctx.body = { started: true, contentTypes: result.total, depth };
      return undefined;
    },
  };
};

export default contentBriefController;
