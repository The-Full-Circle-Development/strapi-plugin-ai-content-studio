/**
 * The single token-gated NON-ADMIN route.
 *
 * A deliberate, recorded deviation from "all plugin routes are type:'admin'" (plan -> Complexity
 * Tracking): the consuming front-end has no admin session, so it cannot call an admin route, and
 * FR-013 requires a not-yet-ingested attachment to render in the preview.
 *
 * It exposes NO chat, NO tools, and NO settings. It serves bytes for one signed, short-lived,
 * `pending`-only preview session and nothing else. There is no listing endpoint.
 */
export default {
  type: 'content-api',
  routes: [
    {
      method: 'GET',
      path: '/preview/:sessionId/file/:fileId',
      handler: 'preview.file',
      config: {
        // Auth is the HMAC-signed token, verified in the handler before any database access.
        auth: false,
        policies: [],
      },
    },
  ],
};
