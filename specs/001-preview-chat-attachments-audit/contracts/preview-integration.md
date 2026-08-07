# Contract: Preview Integration (front-end + non-admin surfaces)

**Feature**: [../spec.md](../spec.md) | **Research**: [../research.md](../research.md#r2--how-does-the-front-end-render-changes-that-are-not-in-the-database) | **Date**: 2026-08-07

This is the only part of the feature that reaches outside the admin panel. It is **opt-in**
(`preview.enabled: false` by default) and completely inert without a valid signed token.

---

## What the consuming site must do

Exactly one thing: **forward the preview token to its Strapi content-API requests.**

1. The panel opens `previewUrl`, which is `preview.baseUrl` + the path resolved for the target
   document + `?aiStudioPreview=<token>`.
2. The site reads that query parameter (server-side, like any preview/draft-mode secret).
3. The site includes it on every Strapi REST fetch for that render, as either
   - `x-ai-studio-preview: <token>` (preferred), or
   - `?aiStudioPreview=<token>` on the Strapi URL.
4. Nothing else. No SDK, no merge logic, no schema knowledge — the response the site receives already
   contains the proposed values.

Sites that already implement Strapi draft preview have this seam; the token rides the same path the
draft secret does. Nothing about the site's rendering, caching keys aside, needs to change.

```ts
// illustrative — the site's existing Strapi fetch helper
const res = await fetch(`${STRAPI}/api/pages?filters[slug][$eq]=${slug}&populate=deep`, {
  headers: {
    ...(previewToken ? { 'x-ai-studio-preview': previewToken } : {}),
  },
  cache: 'no-store',   // a previewed render must not be cached or served to anyone else
});
```

**Caching rule**: a request carrying the token must not be cached, and a previewed response must never
be stored in a shared cache or ISR artifact. The plugin sets `Cache-Control: no-store` on overlaid
responses, but the site must not defeat it.

---

## Surface 1 — content-API response overlay (middleware)

A plugin middleware in the content-API pipeline. Registered always; does nothing unless
`preview.enabled` **and** a token is present.

**Algorithm** (read-only from first line to last):

1. Extract the token from the header or the query string. Absent ⇒ `return next()` untouched.
2. Verify `HMAC-SHA256` and `exp` using the labelled subkey of `AI_STUDIO_ENC_KEY`. Invalid or expired
   ⇒ `return next()` untouched — an invalid token is **ignored, never an error**, so a stale link
   degrades to the live site rather than breaking the page.
3. Load the preview session by `sessionId`. Reject unless: not revoked, not expired, and its change set
   is still `pending`.
4. `await next()` — let Strapi produce its normal response.
5. Walk `ctx.body.data` (object or array, including `attributes`-shaped and flattened v5 payloads) and,
   for each entry matching an overlay key by content-type uid + `documentId`, replace the proposed
   fields. Dotted paths address component fields.
6. Rewrite any media field fed by an attachment to a media-shaped object with a **negative `id`** and a
   staged-file URL (Surface 2).
7. Set `Cache-Control: no-store` and the response header `x-ai-studio-preview: applied`.

**Guarantees**:

- No write, no publish, no queued job (FR-015).
- Only the pending values of the token's own change set are ever exposed; the overlay carries no other
  user's data and no unrelated document (FR-011).
- An anonymous request without the token is byte-for-byte what it was before this feature (FR-011,
  scenario US2-2).
- GraphQL is **not** overlaid in v1; the panel falls back to the field comparison for those projects.

---

## Surface 2 — staged preview file

`GET /ai-content-studio/preview/:sessionId/file/:fileId?token=<token>`

Serves the bytes of an attachment that has deliberately **not** been ingested into the Media Library,
so the proposed image renders in the preview (FR-013).

- The token is the same HMAC-signed preview token, verified identically; it must match `:sessionId`.
- Bytes live in the creating instance's memory, bounded by `attachments.totalBudgetMb`.
- Responds `Content-Type` from the staged MIME type, `Cache-Control: no-store`, and
  `Content-Disposition: inline`.
- `404` on: unknown session, revoked/expired session, unknown `fileId`, resolved change set, or bytes
  held by a different instance. A `404` degrades the preview to the current image — it never breaks the
  page.
- No listing endpoint exists; a `fileId` is an unguessable id and is only ever reachable with the
  matching signed token.

**Why this is not an admin route**: the front-end renders server-side and in the browser without an
admin session, so an `admin::isAuthenticatedAdmin` route cannot serve it. The compensating controls are
the signed token, the 30-minute expiry, the `pending`-only precondition, the absence of enumeration,
and `preview.enabled` defaulting to `false`. This is recorded as a deliberate deviation in the plan's
Complexity Tracking.

---

## Configuration

```ts
// config/plugins.ts in the consuming project
export default ({ env }) => ({
  'ai-content-studio': {
    enabled: true,
    config: {
      preview: {
        enabled: true,
        baseUrl: env('AI_STUDIO_PREVIEW_BASE_URL'),   // e.g. https://staging.example.com
        ttlMinutes: 30,
        paths: {
          'api::page.page': '/:slug',
          'api::blog-post.blog-post': '/blog/:slug',
          'api::homepage.homepage': '/',
        },
      },
    },
  },
});
```

- `paths` maps a content-type uid to a path pattern; `:token` segments are filled from the target
  document's fields (`:slug`, `:documentId`).
- A content type with no `paths` entry, or `preview.enabled: false`, or a missing `baseUrl` ⇒ the
  preview request answers `409 preview_not_configured` with `fallback: "field-diff"` and approval is
  never blocked (FR-014).

---

## Token

| Property | Value |
|----------|-------|
| Algorithm | HMAC-SHA256 |
| Signed payload | `{ sessionId, ownerId, changeSetId, exp }` |
| Key | labelled subkey derived from `AI_STUDIO_ENC_KEY` (no new env var) |
| Lifetime | `preview.ttlMinutes`, default 30 |
| Scope | one preview session; valid only while its change set is `pending` |
| Revocation | apply, reject, expiry, thread deletion, or `AI_STUDIO_ENC_KEY` rotation |
| Transport | `x-ai-studio-preview` header, or `aiStudioPreview` query parameter |

The token is a bearer credential for one pending change set: anyone holding it within its lifetime sees
those proposed values. It is deliberately short-lived, single-purpose, and carries no ability to write.
It must not be logged; treat it like the provider keys — the redaction helper covers it.
