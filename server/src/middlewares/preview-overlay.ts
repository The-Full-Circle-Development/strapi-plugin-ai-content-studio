import type { Core } from '@strapi/strapi';
import type { PreviewOverlay } from '../types';

/**
 * Content-API response overlay.
 *
 * Read-only from the first line to the last (FR-015). When a request carries a valid signed preview
 * token, the pending change set's proposed values are laid over the response body IN MEMORY. Stored
 * content is never touched, nothing is published, and no job is queued.
 *
 * Order matters:
 *   1. no token          -> next(), byte-for-byte the response this project always returned;
 *   2. token fails HMAC or is expired -> next() UNTOUCHED. An invalid token is IGNORED, never an
 *      error, so a stale link degrades to the live site rather than breaking the page, and the
 *      token cannot be used to probe. Verification is pure crypto and happens BEFORE any database
 *      access, so junk costs one HMAC and no query;
 *   3. session must exist, be unrevoked, unexpired, and its change set still `pending`;
 *   4. await next() -> let Strapi produce its normal response, then walk it.
 *
 * REST only. Overlaying GraphQL means walking a resolver result shaped by an arbitrary query; those
 * projects get the in-panel field comparison instead (R2, R14) and the README says so.
 */

const HEADER = 'x-ai-studio-preview';
const QUERY_PARAM = 'aiStudioPreview';

/** Read a token from the preferred header or the query-string fallback. */
const extractToken = (ctx: any): string | null => {
  const header = ctx.request?.header?.[HEADER];
  if (typeof header === 'string' && header.trim() !== '') {
    return header.trim();
  }
  const query = ctx.request?.query?.[QUERY_PARAM];
  if (typeof query === 'string' && query.trim() !== '') {
    return query.trim();
  }
  return null;
};

/** Write a dotted path (`hero.headline`, `sections[1].title`) into an entry, in place. */
const applyPath = (entry: Record<string, unknown>, path: string, value: unknown): void => {
  const segments = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cursor: any = entry;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    if (cursor[segment] === null || cursor[segment] === undefined || typeof cursor[segment] !== 'object') {
      // The response did not populate this branch; creating it would invent structure the
      // front-end never asked for, so leave the entry alone.
      return;
    }
    cursor = cursor[segment];
  }
  cursor[segments[segments.length - 1]] = value;
};

/**
 * Overlay one entry if the token's change set targets it. Handles both v5 flattened payloads and
 * the `attributes`-shaped form, since a project may use either.
 */
const overlayEntry = (entry: any, overlay: PreviewOverlay, uidHint: string | null): boolean => {
  if (!entry || typeof entry !== 'object') {
    return false;
  }
  const documentId = entry.documentId ?? entry.attributes?.documentId;
  if (typeof documentId !== 'string') {
    return false;
  }

  // Match on documentId across the overlay; a documentId is unique per content type, and matching
  // the uid too would require inferring it from the route, which is fragile across custom routes.
  let fields: Record<string, unknown> | null = null;
  if (uidHint && overlay[uidHint]?.[documentId]) {
    fields = overlay[uidHint][documentId];
  } else {
    for (const byDocument of Object.values(overlay)) {
      if (byDocument[documentId]) {
        fields = byDocument[documentId];
        break;
      }
    }
  }
  if (!fields) {
    return false;
  }

  // `attributes`-shaped payloads keep their fields one level down.
  const target = entry.attributes && typeof entry.attributes === 'object' ? entry.attributes : entry;
  for (const [path, value] of Object.entries(fields)) {
    applyPath(target as Record<string, unknown>, path, value);
  }
  return true;
};

/** Walk `data`, which is an entry or a list of entries. */
const overlayBody = (body: any, overlay: PreviewOverlay, uidHint: string | null): boolean => {
  if (!body || typeof body !== 'object') {
    return false;
  }
  const data = body.data;
  if (Array.isArray(data)) {
    let applied = false;
    for (const entry of data) {
      applied = overlayEntry(entry, overlay, uidHint) || applied;
    }
    return applied;
  }
  return overlayEntry(data, overlay, uidHint);
};

/** Best-effort content-type uid from a REST content-API path, e.g. /api/pages -> api::page.page. */
const uidFromPath = (strapi: Core.Strapi, path: string): string | null => {
  const match = /^\/api\/([^/?]+)/.exec(path ?? '');
  if (!match) {
    return null;
  }
  const plural = match[1];
  for (const [uid, ct] of Object.entries(strapi.contentTypes as Record<string, any>)) {
    if (uid.startsWith('api::') && ct?.info?.pluralName === plural) {
      return uid;
    }
  }
  return null;
};

const previewOverlayMiddleware = (
  _config: unknown,
  { strapi }: { strapi: Core.Strapi }
): Core.MiddlewareHandler => {
  return async (ctx: any, next: () => Promise<void>) => {
    const token = extractToken(ctx);
    if (!token) {
      return next();
    }

    // Only the REST content API is overlaid.
    if (typeof ctx.request?.path !== 'string' || !ctx.request.path.startsWith('/api/')) {
      return next();
    }

    const plugin = strapi.plugin('ai-content-studio');
    if (!plugin?.service('config').getPreviewOptions().enabled) {
      return next();
    }

    // Pure crypto, before any database access. Invalid or expired => ignored.
    const payload = plugin.service('crypto').verifyPreviewToken(token);
    if (!payload) {
      return next();
    }

    const session = await plugin.service('preview').resolveSession(payload);
    if (!session) {
      return next();
    }

    await next();

    try {
      const uidHint = uidFromPath(strapi, ctx.request.path);
      const applied = overlayBody(ctx.body, session.overlay, uidHint);
      // A previewed response must never be cached or served to anyone else.
      ctx.set('Cache-Control', 'no-store');
      ctx.set(HEADER, applied ? 'applied' : 'no-match');
    } catch (err) {
      // A malformed body must never break the page — leave the live response as it stands.
      strapi.log.warn(
        `[ai-content-studio] preview overlay skipped: ${plugin.service('redact').describeError(err)}`
      );
    }
    return undefined;
  };
};

export default previewOverlayMiddleware;
