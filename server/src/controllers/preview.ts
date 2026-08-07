import type { Core } from '@strapi/strapi';

/**
 * Staged preview files — the ONE non-admin surface besides the overlay middleware.
 *
 * It exists because the consuming site renders server-side and in the browser with no admin
 * session, so an `admin::isAuthenticatedAdmin` route cannot serve it. Compensating controls:
 *   - the same HMAC-signed preview token, verified identically, and it must match `:sessionId`;
 *   - a 30-minute TTL and a `pending`-only precondition;
 *   - no listing endpoint — a `fileId` is an unguessable uuid reachable only with the signed token;
 *   - `preview.enabled` defaults to false, so the surface does nothing until a project opts in;
 *   - strictly read-only, `Cache-Control: no-store`.
 *
 * Every miss is a plain 404, which degrades the preview to the CURRENT image. It never breaks the
 * page, and it discloses nothing about whether a session or file exists.
 */

const previewController = ({ strapi }: { strapi: Core.Strapi }) => ({
  async file(ctx: any) {
    const plugin = strapi.plugin('ai-content-studio');
    if (!plugin.service('config').getPreviewOptions().enabled) {
      return ctx.notFound();
    }

    const token = typeof ctx.request.query?.token === 'string' ? ctx.request.query.token : null;
    const payload = plugin.service('crypto').verifyPreviewToken(token);
    // Invalid signature, expired, or a token for a different session: indistinguishable 404s.
    if (!payload || payload.sessionId !== String(ctx.params.sessionId)) {
      return ctx.notFound();
    }

    const staged = await plugin.service('preview').getStagedFile(payload, String(ctx.params.fileId));
    if (!staged) {
      return ctx.notFound();
    }

    ctx.set('Cache-Control', 'no-store');
    ctx.set('Content-Disposition', 'inline');
    ctx.type = staged.mimeType;
    ctx.body = staged.bytes;
    return undefined;
  },
});

export default previewController;
