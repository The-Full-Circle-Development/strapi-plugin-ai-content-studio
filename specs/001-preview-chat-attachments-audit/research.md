# Phase 0 Research: Preview, Persistent Chat, Deferred Attachments & Audit Modes

**Feature**: [spec.md](./spec.md) | **Date**: 2026-08-07

Every unknown in the plan's Technical Context is resolved below. Findings marked **(verified)** were
checked against this repository — the committed `dist/server` bundle for AI SDK capabilities, and the
existing sources for Strapi integration points. `node_modules/` is not installed in this checkout, so
SDK capability checks were made by probing the bundled build that ships to consumers, which is the
build the feature will actually run on.

---

## R1 — How is "nothing is written without approval" enforced?

**Decision**: Remove direct write capability from the model. `createEntry`, `updateEntry` and
`publishEntry` are replaced by a single **`proposeChanges`** tool that persists a pending change set
and returns the plan. Applying is a **deterministic admin route** (`POST /change-sets/:id/apply`)
driven by the user's click — the model is not in the loop at apply time.

**Rationale**: FR-001 requires that no write happens without explicit approval, and FR-004 requires
permissions to be re-checked *at apply time*. If approval is mediated by the model (a "please
confirm?" turn), the guarantee lives in a prompt, and prompts are not an enforcement boundary — a
jailbreak, a confused multi-step plan, or a provider that ignores instructions all bypass it.
Moving apply into a plain HTTP route makes the guarantee structural: there is no code path from the
model to the Document Service at all. It also gives a natural home for staleness checks, destructive
confirmation, per-item outcomes, and the audit trail (FR-005..FR-008).

**Alternatives considered**:

- *AI SDK human-in-the-loop tool confirmation* (a tool declared without `execute`, resolved by the
  client with `addToolResult`): idiomatic and the SDK supports it, but the write still executes
  inside the model's step loop, so the model chooses when to resume and what arguments to resume
  with. Rejected for the same reason as prompt-based confirmation — it protects against accidents,
  not against the model.
- *Keep write tools, add an approval prompt*: smallest diff, no structural guarantee. Rejected.
- *Write a draft and let the user discard it*: persists content before approval, contradicting
  decision D1 in the spec. Rejected.

**Consequence to accept**: the assistant can no longer say "done" mid-conversation; it says "here is
the plan". The system prompt must be rewritten around proposing, and the existing prompt's
"after EACH write, report the outcome" guidance moves to the apply route's response.

---

## R2 — How does the front-end render changes that are not in the database?

**Decision**: A **content-API response overlay**. A plugin middleware inspects outgoing content-API
responses; when the request carries a valid, signed, short-lived preview token, the middleware
overlays the pending change set's proposed values onto the response body in memory. Stored content is
never touched. The front-end needs one change only: forward the token it received on the preview URL
to its Strapi fetches (as `x-ai-studio-preview: <token>` or `?aiStudioPreview=<token>`).

**Rationale**: This is the only option that satisfies "before persisting to the database" (D1) while
rendering on the *real* front-end, and it costs the consuming site almost nothing — most Strapi
front-ends already have a preview/draft mode that forwards a secret, so forwarding one more header
fits an existing seam. It is inert without a token, read-only by construction, and provider- and
framework-agnostic.

**Scope bounds established here**:

- **REST content API only** in v1. Overlaying a GraphQL response means walking a resolver result
  shaped by an arbitrary query; the effort is disproportionate. GraphQL front-ends get the in-panel
  field comparison fallback (FR-014) and the README says so.
- **Staged media**: a pending change set may reference an attachment that is deliberately not in the
  Media Library (FR-013). Opening a preview promotes the held bytes to an ephemeral, token-gated
  **staging store** — *not* the Media Library — and the overlay rewrites the media field to a
  media-shaped object whose `url` points at the staged file and whose `id` is negative, so nothing
  downstream can mistake it for a library entry.
- **Staged bytes live in the creating instance's memory**, capped by the 50 MB per-conversation
  budget. On a multi-instance deployment a staged-file request may land on an instance without the
  bytes; it returns 404 and the preview shows the current image instead of the proposed one. Field
  overlays are unaffected because the change set and preview session are in the database. This
  limitation is documented rather than engineered around, because the alternative (shared blob
  storage for unapproved user files) contradicts the point of deferred ingestion.

**Alternatives considered**:

- *Strapi's native Preview feature*: previews a **draft**, so content must be written first —
  contradicts D1. Rejected. (Native Preview remains complementary: nothing here prevents a project
  from also using it for ordinary draft review.)
- *Fetch-and-rewrite the rendered page inside the panel*: the plugin proxies the site's HTML and
  patches text. Brittle against hydration, breaks assets and routing. Rejected.
- *Require the front-end to call a plugin endpoint and merge client-side*: pushes real work into every
  consuming repo, and server-rendered pages would need bespoke handling per framework. Rejected in
  favour of the transparent overlay.
- *Signed URL with the whole overlay encoded in the query string*: no server state, but URLs blow past
  length limits and the overlay would be readable/forgeable client-side. Rejected.

---

## R3 — Where do conversations and change sets live?

**Decision**: Three **plugin content types**, hidden from the Content Manager
(`pluginOptions: { 'content-manager': { visible: false } }`, no draft & publish):
`chat-thread`, `chat-message`, `change-set`. `preview-session` is a fourth, small one. Change *items*
are stored as a JSON column on `change-set` rather than as their own type. Access goes through a
service that always scopes queries to `ctx.state.user.id`.

**Rationale**: Plugin content types get schema sync, migrations, and a query API for free, and they
survive restarts and work across instances — both required by FR-016 and by the multi-instance note in
R2. Hiding them from the Content Manager keeps chat history out of editors' content lists and, more
importantly, prevents the generic content-manager RBAC from becoming a second, weaker door onto other
users' conversations: the only reader is the plugin's own owner-scoped service. Change items are read
and written as a whole set, never queried individually, so a JSON column avoids a table and a join for
no loss.

**Isolation rule (FR-017)**: ownership is taken from the authenticated caller and never from the
request body; a thread id that does not belong to the caller is a 404, not a 403, so thread ids are
not enumerable. Super-admin gets no exemption — this is deliberate and differs from how the rest of
Strapi treats super-admin, so it is called out in the README.

**Alternatives considered**:

- *Raw `strapi.db` tables via a custom migration*: more control, but hand-rolled schema management and
  no free sync. Rejected as unjustified complexity.
- *Plugin store (a single JSON blob per user)*: no querying, unbounded row growth, write contention
  between browser tabs. Rejected.
- *Browser storage*: fails FR-016 (survive restarts, follow the user across devices) outright.
  Rejected.

---

## R4 — How do modes constrain behaviour?

**Decision**: The mode travels with the chat request (`mode: 'content' | 'layout' | 'audit'`,
validated with zod), is persisted on the thread, and selects **both** the tool set and the system
prompt at request build time. Mode is a filter over the tools the caller is already allowed to use —
it never adds one (FR-031).

| Mode | Tools exposed |
|------|---------------|
| `content` (default) | read tools + `proposeChanges` |
| `layout` | read tools + `describePageStructure` + `proposeChanges` |
| `audit` | read tools + `runQaScan` + `runSecurityAudit` (permission-gated). **No `proposeChanges`** |

**Rationale**: Because writes only exist as `proposeChanges` (R1), "read-only mode" is enforced by not
building that tool — there is no capability to refuse at runtime, which is the strongest form of
FR-029. Deriving the tool set per request also keeps the existing per-request permission model intact.

**Alternatives considered**: prompt-level mode instruction (unenforceable, rejected); separate routes
per mode (duplicates the streaming controller for no gain, rejected).

---

## R5 — Deferred attachments: how does the model see a file it cannot be sent?

**Decision**: Two channels per message.

1. **Attachment manifest** (always): ordinal, filename, MIME type, size — sent in the request body and
   rendered into the message text the model sees. This is what makes "image #1 → Hero" resolvable on
   any provider (FR-034, FR-036).
2. **Inline file parts** (only when useful): image bytes as data URLs, attached to the last message
   only, and only when the active model reports vision support. This preserves the existing
   `supportsVision` trimming already implemented in the chat controller.

Bytes stay in the browser until ingestion. Ingestion is a separate, explicit step
(`POST /attachments/ingest`, multipart) that runs **only** after the user approves a plan containing
ingestion or explicitly asks to upload, checks the caller's upload-create permission, and is
idempotent on `(threadId, ordinal, contentHash)` so a retry cannot double-ingest (FR-037).

**Rationale**: the current code uploads on send and pastes the resulting media ids into the message —
that is what makes deferral impossible today, and it is also why abandoned conversations litter the
library. The manifest replaces the media-id note as the model's handle on a file, so placement works
before anything is ingested and on non-vision models alike.

**Limits (FR-032)**: a `GET /attachments/limits` endpoint returns the host's effective Media Library
size limit plus the plugin's per-conversation budget, so the composer rejects a file *before* the
message is sent with the real reason. Strapi's Media Library does not impose a MIME allow-list by
default, so "any type the Media Library allows" is enforced as: whatever the host's upload
configuration accepts, size limit included — the plugin adds no allow-list of its own.

**Alternatives considered**: server-side holding of unapproved bytes for the whole conversation
(contradicts the requirement's intent and creates an unapproved-file store, rejected); base64 in the
thread history (bloats persisted messages, re-sent on every turn, rejected); text extraction from
documents to feed the model (real value, but new dependencies and out of scope here — noted as future
work).

---

## R6 — Aborting a generation server-side

**Decision (verified)**: Wire an `AbortController` to the Koa request lifecycle (`ctx.req` `close` /
`aborted`) and pass its signal as `streamText({ abortSignal })`. Persist the partial assistant message
from `onAbort({ steps })`, marked interrupted; persist normally from `onFinish`. The client already
calls the chat hook's `stop()`, which aborts the underlying fetch and therefore triggers the server
signal — no new client transport work is needed beyond keeping that wiring.

**Verification**: `abortSignal`, `onAbort({ steps })`, `onFinish`, `originalMessages`,
`generateMessageId`, `messageMetadata` and `consumeSseStream` are all present in the committed
`dist/server` bundle, so the shipped AI SDK v6 build supports this pattern.

**Rationale**: FR-025 requires the server work to actually stop, not just the UI to look stopped.
Today `stop()` ends the client stream while the server keeps running steps — including tool steps that
could write. With R1 in place a stray step can no longer write content, but it can still burn provider
tokens and run reads, so the abort signal is still required.

**Alternatives considered**: an explicit `POST /chat/:id/stop` route keyed by a generation id (needed
only if a proxy hides client disconnects; kept as a documented fallback, not built in v1);
`stopWhen`-based step limits (already present, orthogonal).

---

## R7 — What exactly does the QA scan check?

**Decision**: A read-only `runQaScan` tool over runtime introspection (`strapi.contentTypes`,
`strapi.components`, and permission-filtered document reads). Checks, each mapping to FR-040:

| Check | Source of truth |
|-------|-----------------|
| Required field empty on an existing entry | schema `required` + entry values |
| Relation pointing at a missing document | relation targets + existence probe |
| Media field referencing a missing file | media ids vs upload file records |
| Value outside an enumeration's allowed set | schema `enum` + entry values |
| Component usage that cannot render (missing component, required component field empty) | `strapi.components` + entry values |
| Single type never created | `kind === 'singleType'` + `findFirst` |
| Published entry failing its own required fields | draft/publish state + schema |

Every check is bounded by a 2-minute deadline and a per-content-type sample cap; whatever the deadline
cuts off is reported as uncovered (FR-044). Content types the caller may not read are skipped and
listed (FR-043).

**Rationale**: these are the defect classes that runtime data can prove, which keeps findings concrete
(location + evidence + fix) and keeps the false-positive rate inside SC-011. Anything requiring source
analysis is excluded by decision D2.

**Alternatives considered**: schema-only linting (misses the data defects that actually break
rendering); exhaustive scans with no cap (breaches SC-012 on large projects, and an unbounded scan
inside a chat turn is a self-inflicted outage). Both rejected.

---

## R8 — What does the security audit check, and who may see it?

**Decision**: A read-only `runSecurityAudit` tool, exposed only in `audit` mode and only to callers
holding a new `audit.run` permission action (registered in `bootstrap.ts`, super-admin by default).
Checks map to FR-046: public/unauthenticated content-API exposure, create/update/delete/publish
granted to the public role, admin roles holding permissions outside their stated scope, upload rules
accepting executable or script types, `showProviderErrorDetails` enabled, and secret-like values
stored in content fields or plugin configuration.

**Masking rule (FR-049, Constitution I)**: masking happens at the **tool boundary**, before the result
is handed to the model — not in the UI. Anything key-shaped is reduced to a mask plus its location, so
a secret can never reach the provider, the transcript, or a log line. The existing `redactSecrets`
helper in the chat controller moves into a shared place so the audit and the streaming error path use
one implementation.

**Rationale**: the audit's output is a map of a project's weak points, so it is itself sensitive
(decision D3) — hence a dedicated permission and a refusal that discloses nothing partial (FR-048).
Gating inside the tool (rather than on a route) keeps the check on the caller's live ability, matching
Constitution II's "re-derive per request".

**Alternatives considered**: super-admin-only via the existing `is-super-admin` policy (simpler, but
not delegable and the constitution reserves that policy for settings, rejected); making the audit an
admin route the UI calls directly instead of a tool (loses the conversational "explain this finding"
follow-up that motivates putting it in chat, rejected — though the route remains an option if audits
grow long-running).

---

## R9 — Long threads and the context window

**Decision**: Send the thread's recent messages verbatim up to a token budget; older turns are
replaced by a running summary produced from the same provider, stored on the thread and refreshed when
the tail grows past the budget. The UI states when history was condensed (FR-021).

**Rationale**: FR-021 forbids failing a request because a thread got long, and condensing is the only
option that keeps multi-session work coherent. Storing the summary on the thread keeps it cheap
(computed on crossing the threshold, not per message) and provider-neutral.

**Alternatives considered**: hard truncation (silently loses the referent that FR-020 exists to
preserve); resending everything and letting the provider error (fails FR-021); vector retrieval over
history (new dependency and storage for a marginal gain at this scale — rejected under the
constitution's complexity rule).

---

## R10 — Staleness and exactly-once apply

**Decision**: Each change item stores a **base fingerprint** at propose time: the target document's
`updatedAt` plus a hash of the current values of exactly the fields the item touches. Apply re-reads
and compares; a mismatch marks that item `stale` and applies nothing for it (FR-005). Each change set
carries an `appliedAt` and per-item outcomes; apply is rejected unless the set is `pending`, making a
double-approval a no-op rather than a second write. Attachment ingestion has its own idempotency key
(R5).

**Rationale**: field-level fingerprinting is precise enough that an unrelated edit elsewhere in the
document does not block a legitimate change, while a genuine conflict on the same field is always
caught. Document-level `updatedAt` alone would refuse too much; no check at all silently overwrites a
colleague, which is the failure the edge case list calls out.

---

## R11 — Preview token signing without a new env var

**Decision**: HMAC-SHA256 over `{ sessionId, ownerId, changeSetId, exp }`, keyed by a subkey derived
from the existing `AI_STUDIO_ENC_KEY` with a fixed purpose label (HKDF-style), implemented inside
`services/crypto.ts`. Tokens are opaque, single-purpose, and expire in 30 minutes.

**Rationale**: FR-054 requires safe defaults and no new mandatory configuration, so introducing a
second required secret is out. Deriving a labelled subkey keeps the preview key cryptographically
separate from the key-encryption key while inheriting its boot-time validation, and Constitution I's
"crypto stays isolated in `services/crypto.ts`" is respected by putting the derivation there. Rotating
`AI_STUDIO_ENC_KEY` invalidates outstanding previews — harmless, they last 30 minutes — and the README
note about rotation already covers the general consequence.

**Alternatives considered**: a random opaque token stored in the database (no signing needed, but a DB
hit on every overlaid request in a page's fetch fan-out; the HMAC lets the middleware reject junk
tokens before touching the database and still look up the overlay once per validated request);
reusing Strapi's `APP_KEYS` (couples the plugin to app-level secret rotation, rejected).

---

## R12 — Admin UI decomposition

**Decision**: Split `admin/src/pages/Chat.tsx` (currently 814 lines) into a page shell plus
components — `ThreadSidebar`, `ModeSelect`, `Composer` (with attachments), `MessageList`,
`ChangePlanCard`, `PreviewPanel` — and hooks `useThreads`, `useChangeSet`, `useAttachments`. Styling
stays `styled-components` + `@strapi/design-system` v2; no new UI dependency is added.

**Rationale**: this feature adds a thread list, a mode selector, a plan card with per-item selection,
a preview action and a fallback diff view to a file that is already at its comprehension limit.
Splitting first is cheaper than splitting later, and the constitution's UI constraint (design system
only) rules out reaching for a component library to do it.

---

## R13 — Configuration surface and defaults

**Decision**: extend the existing plugin config (`server/src/config/index.ts`) with safe defaults only:

| Option | Default | Effect |
|--------|---------|--------|
| `preview.enabled` | `false` | Preview off until a project opts in; the panel then uses the field-comparison fallback |
| `preview.baseUrl` | `undefined` | Front-end origin for preview URLs (env `AI_STUDIO_PREVIEW_BASE_URL`) |
| `preview.paths` | `{}` | Map of content-type uid → path pattern (e.g. `api::blog-post.blog-post` → `/blog/:slug`) |
| `preview.ttlMinutes` | `30` | Preview and pending-change-set lifetime |
| `attachments.totalBudgetMb` | `50` | Held-attachment budget per conversation |
| `audit.timeBudgetSeconds` | `120` | QA / security pass deadline |

**Rationale**: FR-054 requires an existing install to keep working untouched after upgrade, so every
new option defaults to today's behaviour and preview — the only option that opens a non-admin surface
— is opt-in. Nothing new becomes a required env var (R11).

---

## R14 — Accepted limitations (recorded so they are not rediscovered as bugs)

- GraphQL content API is not overlaid in v1; those projects get the fallback comparison (R2).
- Staged preview media is served from the creating instance's memory; multi-instance deployments may
  show the current image instead of the proposed one, and a restart expires previews early (R2).
- Held attachments do not survive a panel reload, by design (spec decision, FR-038).
- Audits inspect the running configuration, never project source files (spec decision D2).
- There is still no automated test suite; verification is the manual script in
  [quickstart.md](./quickstart.md), per Constitution V.
