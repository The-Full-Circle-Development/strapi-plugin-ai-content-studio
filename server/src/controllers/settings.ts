import { z } from 'zod';
import type { Core } from '@strapi/strapi';
import { parseBaseUrl } from '../services/config';
import { PROVIDER_IDS } from '../services/providers';

/**
 * Settings surface (contracts/provider-layer.md §4).
 *
 * Reads return a MASKED shape only — plaintext keys never leave the server (Principle I). Writes
 * are write-only for the credential and validated for everything else.
 *
 * `baseUrl` is returned IN FULL on read: it is configuration, not a secret, and keeping it a
 * distinct field is precisely what stops it being conflated with the credential (FR-008).
 */

/**
 * One provider's patch. `apiKey` has three distinct states and they are NOT interchangeable:
 *   - absent        -> keep the stored key
 *   - explicit null -> clear it
 *   - a string      -> encrypt and store it
 * It is never echoed back on any path.
 */
const providerPatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    apiKey: z.string().nullable().optional(),
    baseUrl: z.string().nullable().optional(),
  })
  .strict();

const bodySchema = z
  .object({
    activeProvider: z.string().optional(),
    // Deliberately unconstrained beyond "a string": stored VERBATIM, never validated against a
    // curated list, never normalized, lowercased or date-suffixed (FR-004, FR-005).
    activeModel: z.string().optional(),
    grounding: z.object({ enabled: z.boolean() }).strict().optional(),
    providers: z.record(z.string(), providerPatchSchema).optional(),
  })
  .strict();

const settingsController = ({ strapi }: { strapi: Core.Strapi }) => {
  const configSvc = () => strapi.plugin('ai-content-studio').service('config');

  return {
    /** Returns the MASKED config only — never raw or encrypted keys. */
    async find(ctx: any) {
      ctx.body = await configSvc().getMaskedConfig();
    },

    /** Write-only save: applies only the fields present. */
    async update(ctx: any) {
      const parsed = bodySchema.safeParse(ctx.request.body ?? {});
      if (!parsed.success) {
        return ctx.badRequest(
          parsed.error.issues[0]?.message ?? 'Invalid settings payload.',
          { code: 'invalid_body' }
        );
      }
      const body = parsed.data;
      const svc = configSvc();

      // An unknown provider id is refused on WRITE even though reads preserve unknown keys — an
      // administrator cannot introduce a provider the layer does not know (FR-002).
      if (body.activeProvider !== undefined && !PROVIDER_IDS.includes(body.activeProvider)) {
        return ctx.badRequest(`Unknown provider "${body.activeProvider}".`, {
          code: 'unknown_provider',
        });
      }
      if (body.providers) {
        for (const id of Object.keys(body.providers)) {
          if (!PROVIDER_IDS.includes(id)) {
            return ctx.badRequest(`Unknown provider "${id}".`, { code: 'unknown_provider' });
          }
        }
      }

      // Validate EVERY base URL before writing anything, so one bad field does not leave a
      // half-applied save behind.
      const baseUrlWrites: Array<{ id: string; value: string | null }> = [];
      if (body.providers) {
        for (const [id, patch] of Object.entries(body.providers)) {
          if (patch.baseUrl === undefined) {
            continue;
          }
          const result = parseBaseUrl(patch.baseUrl);
          if (!result.ok) {
            return ctx.badRequest(`Base URL for "${id}" is invalid: ${result.message}`, {
              code: 'invalid_base_url',
              field: 'baseUrl',
              provider: id,
            });
          }
          baseUrlWrites.push({ id, value: result.value });
        }
      }

      if (body.providers) {
        for (const [id, patch] of Object.entries(body.providers)) {
          if (typeof patch.enabled === 'boolean') {
            await svc.setProviderEnabled(id, patch.enabled);
          }
          if (patch.apiKey === null) {
            // An explicit null CLEARS the stored key.
            await svc.setProviderKey(id, null);
          } else if (typeof patch.apiKey === 'string' && patch.apiKey.trim() !== '') {
            await svc.setProviderKey(id, patch.apiKey.trim());
          }
          // An absent or blank `apiKey` keeps whatever is stored (write-only semantics).
        }
      }

      for (const { id, value } of baseUrlWrites) {
        await svc.setProviderBaseUrl(id, value);
      }

      if (body.grounding) {
        await svc.setGroundingEnabled(body.grounding.enabled);
      }

      // `activeModel` is stored exactly as received. A directly entered identifier must survive a
      // save/reload round trip unchanged (FR-005).
      if (body.activeProvider !== undefined || body.activeModel !== undefined) {
        const current = await svc.get();
        await svc.setActive(
          body.activeProvider ?? current.activeProvider,
          body.activeModel !== undefined ? body.activeModel : current.activeModel
        );
      }

      // Respond with the same masked shape as GET, so the client rehydrates from the server rather
      // than from its own optimistic state.
      ctx.body = await svc.getMaskedConfig();
    },

    /**
     * The grounding inspector (FR-035, contracts/install-description.md §8).
     *
     * `text` is the EXACT text requests are currently carrying for the CALLING account — not a
     * re-render and not a sample. If the inspector and the request could disagree, the inspector is
     * worthless.
     *
     * With grounding off it returns `enabled: false` and `text: null`, plus `disabledBy` naming
     * WHICH switch is holding it off, so the panel can state plainly that requests carry no
     * description — and where to change that — rather than showing a stale one.
     */
    async grounding(ctx: any) {
      const svc = configSvc();
      const { maxChars } = svc.getGroundingOptions();
      // The EFFECTIVE value: the AND of both switches, never one of them (§7).
      const enabled = await svc.isGroundingEnabled();
      const disabledBy = await svc.groundingDisabledBy();

      if (!enabled) {
        ctx.body = {
          enabled: false,
          disabledBy,
          text: null,
          tier: null,
          partial: false,
          charCount: 0,
          maxChars,
          contentTypeCount: 0,
          omittedContentTypeCount: 0,
        };
        return undefined;
      }

      // Scoped to the CALLER's live ability, the same `can.read()` every tool makes (FR-031).
      const description = strapi
        .plugin('ai-content-studio')
        .service('grounding')
        .describe(ctx.state.userAbility);

      if (!description) {
        // The account can read no content type, so its requests carry no description either.
        ctx.body = {
          enabled: true,
          disabledBy: null,
          text: null,
          tier: null,
          partial: false,
          charCount: 0,
          maxChars,
          contentTypeCount: 0,
          omittedContentTypeCount: 0,
        };
        return undefined;
      }

      ctx.body = {
        enabled: true,
        disabledBy: null,
        text: description.text,
        tier: description.tier,
        partial: description.partial,
        charCount: description.charCount,
        maxChars,
        contentTypeCount: description.contentTypeCount,
        omittedContentTypeCount: description.omittedContentTypeCount,
      };
      return undefined;
    },
  };
};

export default settingsController;
