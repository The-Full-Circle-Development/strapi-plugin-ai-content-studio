import type { Core } from '@strapi/strapi';
import { PROVIDERS, type ProviderId } from '../services/config';

interface ProviderPatch {
  enabled?: boolean;
  apiKey?: string;
}

interface UpdateBody {
  activeProvider?: ProviderId;
  activeModel?: string;
  providers?: Partial<Record<ProviderId, ProviderPatch>>;
}

const settingsController = ({ strapi }: { strapi: Core.Strapi }) => {
  const configSvc = () => strapi.plugin('ai-content-studio').service('config');

  return {
    /** Returns the MASKED config only — never raw or encrypted keys. */
    async find(ctx: any) {
      ctx.body = await configSvc().getMaskedConfig();
    },

    /** Write-only save: applies only the fields present; a key is stored only when non-empty. */
    async update(ctx: any) {
      const body = (ctx.request.body ?? {}) as UpdateBody;
      const svc = configSvc();

      if (body.providers) {
        for (const provider of PROVIDERS) {
          const patch = body.providers[provider];
          if (!patch) continue;
          if (typeof patch.enabled === 'boolean') {
            await svc.setProviderEnabled(provider, patch.enabled);
          }
          // Only persist a key when the field was actually filled in (write-only semantics).
          if (typeof patch.apiKey === 'string' && patch.apiKey.trim() !== '') {
            await svc.setProviderKey(provider, patch.apiKey.trim());
          }
        }
      }

      if (
        typeof body.activeProvider === 'string' &&
        PROVIDERS.includes(body.activeProvider) &&
        typeof body.activeModel === 'string' &&
        body.activeModel.trim() !== ''
      ) {
        await svc.setActive(body.activeProvider, body.activeModel.trim());
      } else if (typeof body.activeModel === 'string' && body.activeModel.trim() !== '') {
        const current = await svc.get();
        await svc.setActive(current.activeProvider, body.activeModel.trim());
      } else if (typeof body.activeProvider === 'string' && PROVIDERS.includes(body.activeProvider)) {
        const current = await svc.get();
        await svc.setActive(body.activeProvider, current.activeModel);
      }

      ctx.body = await svc.getMaskedConfig();
    },
  };
};

export default settingsController;
