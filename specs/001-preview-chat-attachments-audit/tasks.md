# Tasks: Preview, Persistent Chat, Deferred Attachments & Audit Modes

**Input**: Design documents from `/specs/001-preview-chat-attachments-audit/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: No automated test tasks are generated. This repository has no test suite and the
specification does not request one; per Constitution V the quality gate is `pnpm run typecheck` plus
the manual script in [quickstart.md](./quickstart.md). Each user story therefore ends with an explicit
**verification task** naming the quickstart scenario and the permission-denied paths it must exercise.

**Organization**: Tasks are grouped by user story so each can be implemented, verified, and shipped
independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: The user story this task belongs to (US1â€“US8)
- Every task names its exact file path

## Path Conventions

Strapi plugin, two halves plus a committed build (see plan.md â†’ Project Structure):

- **Server**: `server/src/` â€” `content-types/`, `middlewares/`, `services/`, `controllers/`,
  `routes/`, `policies/`
- **Admin**: `admin/src/` â€” `pages/`, `components/`, `hooks/`, `translations/`
- **Build**: `dist/` is rebuilt and staged in the same commit as any source change (Constitution IV)

**Per-commit gate** (Constitution): one task per commit, conventional imperative subject, committed
directly to `main`, no `Co-Authored-By` trailer; `pnpm run typecheck` clean and `pnpm run build` run
with `dist/` staged.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Configuration surface and shared helpers every later phase reads from. All six new options
default to today's behaviour so an upgrade is a no-op (FR-054, R13).

- [X] T001 Extend the plugin config with `preview.{enabled:false,baseUrl,paths:{},ttlMinutes:30}`, `attachments.totalBudgetMb:50`, and `audit.timeBudgetSeconds:120` in server/src/config/index.ts
- [X] T002 [P] Add shared feature types (`ChangeItem`, `ChangeSetStatus`, `AttachmentManifestEntry`, `AuditReport`, `AuditFinding`, `PreviewTokenPayload`) in server/src/types.ts
- [X] T003 [P] Extract `redactSecrets` out of server/src/controllers/chat.ts into server/src/services/redact.ts, extend it to treat preview tokens as key-like, and re-point the chat stream error path at the shared helper
- [X] T004 Add typed accessors `getPreviewOptions` / `getAttachmentOptions` / `getAuditOptions` in server/src/services/config.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The four hidden content types, the owner-scoping rule, the preview signing key, the new
permission action, and the admin decomposition. Every user story depends on some part of this phase.

**âš ï¸ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T005 [P] Create the `chat-thread` schema (hidden from Content Manager and CTB, `draftAndPublish:false`, `title`, indexed `ownerId`, `mode` enum, `lastActivityAt`, `contextSummary`, `summarizedThroughMessageId`) in server/src/content-types/chat-thread/schema.json
- [X] T006 [P] Create the `chat-message` schema (`thread` relation, `role`, `sequence`, `parts` json, `attachmentManifest` json, `interrupted`, `modeAtSend`, `changeSet` relation) in server/src/content-types/chat-message/schema.json
- [X] T007 [P] Create the `change-set` schema (`thread` relation, indexed `ownerId`, `status`, `items` json, `expiresAt`, `proposedAt`, `resolvedAt`, `approvedByUserId`, `approvedItemIds`, `destructiveConfirmed`) in server/src/content-types/change-set/schema.json
- [X] T008 [P] Create the `preview-session` schema (`changeSet` relation, indexed `ownerId`, unique `sessionId`, `overlay` json, `stagedFiles` json, `expiresAt`, `revokedAt`, `targetUrl`) in server/src/content-types/preview-session/schema.json
- [X] T009 Create server/src/content-types/index.ts exporting the four types and register `contentTypes` on the plugin in server/src/index.ts
- [X] T010 [P] Add labelled-subkey derivation from `AI_STUDIO_ENC_KEY` plus `signPreviewToken` / `verifyPreviewToken` (HMAC-SHA256 over `{sessionId, ownerId, changeSetId, exp}`) in server/src/services/crypto.ts
- [X] T011 [P] Register the `audit.run` permission action (section `plugins`, display name "Run AI Content Studio security audit") in server/src/bootstrap.ts
- [X] T012 [P] Create the `has-audit-permission` policy and export it from server/src/policies/index.ts in server/src/policies/has-audit-permission.ts
- [X] T013 Create the owner-scoped thread core â€” `createThread`, `getOwnedThread` (returns null for a foreign id so callers answer 404, super-admin included), `appendMessage` with monotonic per-thread `sequence`, `touchLastActivity` â€” and export it from server/src/services/index.ts, in server/src/services/threads.ts
- [X] T014 Create `create` and `findOne` handlers (404, never 403, on a non-owned thread) and export them from server/src/controllers/index.ts, in server/src/controllers/threads.ts
- [X] T015 Add `POST /threads` and `GET /threads/:id` under `admin::isAuthenticatedAdmin` in server/src/routes/index.ts
- [X] T016 Gate `POST /chat` and every new admin route on the `chat.use` action via `admin::hasPermissions` in server/src/routes/index.ts
- [X] T017 Require and zod-validate `threadId` on `POST /chat`, and persist the user turn and the assistant turn through `threads.appendMessage` from `onFinish`, in server/src/controllers/chat.ts
- [X] T018 [P] Decompose admin/src/pages/Chat.tsx (814 lines) into a page shell plus admin/src/components/MessageList.tsx and admin/src/components/Composer.tsx with no behaviour change (R12)
- [X] T019 Create the current-thread resolve/create hook and send `threadId` in the `DefaultChatTransport` body from admin/src/pages/Chat.tsx, in admin/src/hooks/useThreads.ts

**Checkpoint**: Conversations are persisted and owner-scoped; the plugin boots with the new types, the
new permission, and the preview signing key. User story work can begin.

---

## Phase 3: User Story 1 - Approve a change plan before anything is written (Priority: P1) ðŸŽ¯ MVP

**Goal**: The model loses every write tool. `proposeChanges` persists a pending plan; the only code path
that mutates content is `POST /change-sets/:id/apply`, driven by the user's click, which re-checks
permissions, re-checks the per-field fingerprint, demands explicit destructive confirmation, and reports
a per-item outcome.

**Independent Test**: In a running admin panel, ask for a multi-field edit. The entry is unchanged in the
Content Manager while the plan is displayed; rejecting leaves it unchanged; approving applies exactly the
listed fields and nothing else.

### Implementation for User Story 1

- [X] T020 [US1] Implement `createPending` â€” validate `contentTypeUid` against the live `api::*` allow-list and the field path, RBAC-check the caller per item, read `currentValue`, compute `baseFingerprint` `{updatedAt, fieldHash}`, derive `destructive` and `resultingState`, persist `status:'pending'` with `expiresAt` â€” and export the service from server/src/services/index.ts, in server/src/services/change-sets.ts
- [X] T021 [US1] Implement `apply` with the six-step gate in order (owned + `pending` + not expired â†’ item exists and not `denied` â†’ live per-item RBAC re-check â†’ `baseFingerprint` re-check â‡’ `stale` â†’ destructive confirmation â†’ attachment resolutions present), then per-item outcomes and the `applied` / `partially_applied` transition, in server/src/services/change-sets.ts
- [X] T022 [US1] Implement `reject` and `expirePending` (both set `resolvedAt` and leave content, media, and configuration untouched) in server/src/services/change-sets.ts
- [X] T023 [US1] Move `SYSTEM_PROMPT` out of server/src/controllers/chat.ts into server/src/services/prompt.ts and rewrite it around proposing â€” remove the write instructions, remove the hardcoded project field map and the "Concept Bath" identity, keep the permission-denied and Markdown rules
- [X] T024 [US1] Remove the `createEntry`, `updateEntry`, and `publishEntry` tools in server/src/services/tools.ts
- [X] T025 [US1] Add the `proposeChanges` tool â€” zod input, `blocked[]` for items the caller may not perform, `nextStep`, `empty_plan` on an empty items array, `unresolved_placement` with candidates rather than a guess â€” in server/src/services/tools.ts
- [X] T026 [US1] Create `findOne`, `apply`, and `reject` handlers and export them from server/src/controllers/index.ts, in server/src/controllers/change-sets.ts
- [X] T027 [US1] Add `GET /change-sets/:id`, `POST /change-sets/:id/apply`, and `POST /change-sets/:id/reject` in server/src/routes/index.ts
- [X] T028 [US1] Link the produced change set to its `chat-message` and append the approving user, time, and applied items to the thread (FR-008) in server/src/services/threads.ts
- [X] T029 [P] [US1] Create the change-set hook (fetch, per-item selection, apply, reject) in admin/src/hooks/useChangeSet.ts
- [X] T030 [P] [US1] Create the plan card â€” per-item rows showing target type, document label, field, current â†’ proposed value, resulting draft/published state, blocked reason â€” in admin/src/components/ChangePlanCard.tsx
- [X] T031 [US1] Render `ChangePlanCard` for `proposeChanges` tool parts in admin/src/components/MessageList.tsx
- [X] T032 [US1] Add approve-all / approve-selected / reject actions and the separate explicit confirmation for destructive items in admin/src/components/ChangePlanCard.tsx
- [X] T033 [US1] Append the per-item apply report (field, old value, new value, draft/published state, blocked and failed reasons) to the conversation in admin/src/pages/Chat.tsx
- [ ] T034 [US1] Verify US1 in a real admin panel â€” quickstart scenarios 1 and 2, plus permission-denied paths 1, 2, and 4 from contracts/permissions.md

**Checkpoint**: US1 is fully functional and independently testable. This is the MVP â€” no content can be
written without an approved change set.

---

## Phase 4: User Story 2 - See pending changes on the real site before saving (Priority: P2)

**Goal**: A signed, 30-minute preview token makes the content API overlay a pending change set onto its
responses so the real front-end renders proposed values while the database is untouched.

**Independent Test**: With a pending change set that alters a text field and a media field, open the
preview and confirm the front-end renders the proposed values; an anonymous visitor to the same page
still sees the old content; the preview stops working after it expires.

**Depends on**: US1 (the pending change set is what a preview renders).

### Implementation for User Story 2

- [X] T035 [US2] Create the preview service â€” session create / lookup / revoke, precomputed `overlay` payload keyed by `contentTypeUid` + `documentId`, and the in-memory staged-file store bounded by `attachments.totalBudgetMb` â€” and export it from server/src/services/index.ts, in server/src/services/preview.ts
- [X] T036 [US2] Resolve `previewUrl` from `preview.baseUrl` + the `preview.paths` pattern, and return `409 preview_not_configured` with `fallback:'field-diff'` when preview is disabled, the base URL is missing, or the type has no path (FR-014), in server/src/services/preview.ts
- [X] T037 [US2] Implement the read-only overlay middleware â€” extract the token from `x-ai-studio-preview` or `?aiStudioPreview`, verify HMAC and `exp` before any database access, ignore an invalid token rather than erroring, load the session, require the change set still `pending`, `await next()`, walk `ctx.body.data` (array, object, `attributes`-shaped, and flattened v5 payloads) applying dotted-path overlays, rewrite attachment-fed media to a media-shaped object with a **negative `id`** and a staged-file URL, then set `Cache-Control: no-store` and `x-ai-studio-preview: applied` â€” in server/src/middlewares/preview-overlay.ts
- [X] T038 [US2] Create server/src/middlewares/index.ts and register `middlewares` on the plugin in server/src/index.ts
- [X] T039 [US2] Create the staged-file handler for `GET /preview/:sessionId/file/:fileId?token=` (token must match the session; `Content-Disposition: inline`, `Cache-Control: no-store`; 404 on unknown/revoked/expired/resolved/other-instance so a miss degrades to the current image) and export it from server/src/controllers/index.ts, in server/src/controllers/preview.ts
- [X] T040 [US2] Add the single token-gated non-admin route in server/src/routes/preview.ts and mount it alongside the `admin` route set in server/src/routes/index.ts
- [X] T041 [US2] Add the multipart `POST /change-sets/:id/preview` handler (optional `attachment[<ordinal>]` staging, returns `sessionId`, `token`, `previewUrl`, `expiresAt`, `stagedFiles`) in server/src/controllers/change-sets.ts and register the route in server/src/routes/index.ts
- [X] T042 [US2] Revoke preview sessions and drop their staged bytes on apply, reject, expiry, and thread deletion in server/src/services/change-sets.ts
- [X] T043 [US2] Create the preview panel â€” Preview action that opens `previewUrl`, expiry messaging, and the in-panel field-level before/after comparison shown on `409` without blocking approval â€” in admin/src/components/PreviewPanel.tsx
- [ ] T044 [US2] Verify US2 in a real admin panel â€” quickstart scenario 3, plus permission-denied paths 9 and 10 from contracts/permissions.md

**Checkpoint**: US1 and US2 both work independently. Proposed values render on the real front-end with
nothing written.

---

## Phase 5: User Story 3 - Conversations persist per user and survive reloads (Priority: P3)

**Goal**: A per-user thread list that survives reloads and restarts, restores full history, condenses
older context instead of failing, and is unreachable by any other user including super-admin.

**Independent Test**: Start a thread, reload the panel, confirm the thread and its messages are intact
and a follow-up referring to earlier context is answered correctly. Log in as a second admin and confirm
the first user's threads are neither listed nor reachable.

### Implementation for User Story 3

- [ ] T045 [US3] Add `listThreads` (most-recent-first, `limit` 1..100 default 30, `lastActivityAt` cursor), `renameThread`, and `deleteThread` cascading to messages, change sets, preview sessions, and staged files (FR-022), in server/src/services/threads.ts
- [ ] T046 [US3] Add `loadHistory` returning ordered messages in the shape the chat UI replays, plus `contextCondensed` and `expiredAttachments`, in server/src/services/threads.ts
- [ ] T047 [US3] Add context condensing â€” send recent turns verbatim up to a token budget, replace older turns with a running `contextSummary` produced by the active provider, track `summarizedThroughMessageId`, refresh on crossing the threshold (R9, FR-021) â€” in server/src/services/threads.ts
- [ ] T048 [US3] Generate a short (â‰¤ 60 char) automatic title from the first exchange, user-overridable, in server/src/services/threads.ts
- [ ] T049 [US3] Add `find`, `update`, and `delete` handlers in server/src/controllers/threads.ts and register `GET /threads`, `PATCH /threads/:id`, and `DELETE /threads/:id` in server/src/routes/index.ts
- [ ] T050 [US3] Feed the thread's condensed context into the model request instead of trusting client-supplied history in server/src/controllers/chat.ts
- [ ] T051 [P] [US3] Create the thread sidebar (list with title and last-activity time, new thread, select, rename, delete) in admin/src/components/ThreadSidebar.tsx
- [ ] T052 [US3] Extend the hook with list, rename, delete, and history restore in admin/src/hooks/useThreads.ts
- [ ] T053 [US3] Restore a thread's messages into `useChat` on open and surface the condensed-history notice in admin/src/pages/Chat.tsx
- [ ] T054 [US3] Show held attachments from a restored thread as expired, explain they were never ingested, and invite re-attaching (FR-038) in admin/src/components/MessageList.tsx
- [ ] T055 [US3] Verify US3 in a real admin panel â€” quickstart scenario 4, plus permission-denied path 3 from contracts/permissions.md

**Checkpoint**: US1, US2, and US3 all work independently.

---

## Phase 6: User Story 4 - Stop a generation that is going the wrong way (Priority: P4)

**Goal**: Pressing Stop aborts the server-side stream, not just the client view; the partial turn
persists as interrupted and the thread stays usable.

**Independent Test**: Ask for a long multi-step task, press Stop mid-stream, and confirm output stops,
no further tool step runs, and the thread remains usable.

**Depends on**: Foundational turn persistence (T017).

### Implementation for User Story 4

- [ ] T056 [US4] Wire an `AbortController` to the Koa request lifecycle (`ctx.req` `close` / `aborted`) and pass its signal as `streamText({ abortSignal })` in server/src/controllers/chat.ts
- [ ] T057 [US4] Persist the partial assistant turn from `onAbort({ steps })` with `interrupted: true` in server/src/controllers/chat.ts
- [ ] T058 [US4] Report which changes had already been applied earlier in an interrupted turn (FR-026) in server/src/controllers/chat.ts
- [ ] T059 [US4] Keep Stop wired to the chat hook's `stop()`, free the composer immediately, and render interrupted messages distinctly in admin/src/components/Composer.tsx and admin/src/components/MessageList.tsx
- [ ] T060 [US4] Verify US4 in a real admin panel â€” scenario 5 of specs/001-preview-chat-attachments-audit/quickstart.md (output halts within ~2 s, no tool call in the server log after the press, interrupted marker survives a reload)

**Checkpoint**: Stop releases server-side work and leaves an honest record.

---

## Phase 7: User Story 5 - Choose the mode that matches the task (Priority: P5)

**Goal**: `content` / `layout` / `audit` narrow the tool set per request. `audit` mode simply never
builds `proposeChanges`, so read-only is structural rather than a refusal at runtime.

**Independent Test**: Switch a thread to Code Audit, ask for a content change, confirm the assistant
explains writes are unavailable and makes none. Reopen the thread later and confirm the mode persisted.

**Depends on**: US1 (`proposeChanges` must exist to be withheld).

### Implementation for User Story 5

- [ ] T061 [US5] Zod-validate `mode` on `POST /chat`, persist it on the thread, and record `modeAtSend` on each message so history stays readable after a switch, in server/src/controllers/chat.ts
- [ ] T062 [US5] Build the tool set per `(caller ability, mode)` per contracts/model-tools.md â€” modes only ever narrow, never grant (FR-031) â€” in server/src/services/tools.ts
- [ ] T063 [US5] Add the `describePageStructure` tool (RBAC-gated read: section paths, component names, repeatable flags, media and link slots with current values; return all candidates on ambiguity rather than choosing) in server/src/services/tools.ts
- [ ] T064 [US5] Compose the system prompt from a shared base plus a per-mode section, including the audit section (read-only, never invent findings, never reproduce a secret), in server/src/services/prompt.ts
- [ ] T065 [P] [US5] Create the mode selector from `@strapi/design-system` v2 in admin/src/components/ModeSelect.tsx
- [ ] T066 [US5] Display the active mode, default new threads to Content Editing, persist the choice per thread, and send it with every request in admin/src/pages/Chat.tsx and admin/src/hooks/useThreads.ts
- [ ] T067 [US5] Verify US5 in a real admin panel â€” quickstart scenario 6, plus permission-denied path 7 from contracts/permissions.md

**Checkpoint**: Modes narrow capability structurally and persist with the thread.

---

## Phase 8: User Story 6 - Attach files, place them, and only ingest on request (Priority: P6)

**Goal**: Attachments are held in browser memory with stable ordinals, reach the model as a manifest so
placement works on any provider, and enter the Media Library exactly once â€” only at apply time.

**Independent Test**: Attach two images and a PDF with per-file placement instructions and confirm the
Media Library gains nothing while the plan is pending, the plan names the correct file for each target,
approving ingests exactly those files once, and rejecting ingests nothing.

**Depends on**: US1 (approval is the moment of ingestion). Feeds US2 staged preview media.

### Implementation for User Story 6

- [ ] T068 [US6] Create the attachments service â€” effective limits from the host's upload configuration, the per-conversation `totalBudgetMb`, and manifest validation â€” and export it from server/src/services/index.ts, in server/src/services/attachments.ts
- [ ] T069 [US6] Add ingestion that checks the caller's Media Library create permission **before any byte is written** and is idempotent on `(threadId, ordinal, contentHash)` so a retry returns the existing `mediaId` with `deduplicated: true` (FR-037), in server/src/services/attachments.ts
- [ ] T070 [US6] Create the `limits` and multipart `ingest` handlers and export them from server/src/controllers/index.ts, in server/src/controllers/attachments.ts
- [ ] T071 [US6] Add `GET /attachments/limits` and `POST /attachments/ingest` in server/src/routes/index.ts
- [ ] T072 [US6] Accept and zod-validate `attachmentManifest` on `POST /chat`, render it into the model-visible message text on every provider, and keep image file parts on the last message only when the active model supports vision (FR-036), in server/src/controllers/chat.ts
- [ ] T073 [US6] Replace the media-id workflow in the system prompt with the ordinal workflow (`#1` â†’ `attachmentOrdinal`, never a library id) in server/src/services/prompt.ts
- [ ] T074 [US6] Handle `attachmentOrdinal` items in `proposeChanges` (confirm the ordinal exists in this turn's manifest) and `attachmentResolutions` at apply time in server/src/services/tools.ts and server/src/services/change-sets.ts
- [ ] T075 [P] [US6] Create the attachments hook â€” browser-held `File` objects, 1-based ordinals stable for the conversation and never reused, pre-send validation against `GET /attachments/limits`, total-budget enforcement, ingestion-state tracking â€” in admin/src/hooks/useAttachments.ts
- [ ] T076 [US6] Hold attachments in memory with no upload on send, and show each file's ordinal, filename, and rejection reason before the message is sent (FR-032), in admin/src/components/Composer.tsx
- [ ] T077 [US6] Ingest approved files first, then apply with `attachmentResolutions`, and support the ingest-only path with confirmation and no content change (FR-039), in admin/src/hooks/useChangeSet.ts
- [ ] T078 [US6] Verify US6 in a real admin panel â€” quickstart scenario 7, plus permission-denied path 5 from contracts/permissions.md

**Checkpoint**: The Media Library gains nothing from abandoned conversations, and placement works on
non-vision models.

---

## Phase 9: User Story 7 - Find functional defects in the content setup (Priority: P7)

**Goal**: A strictly read-only QA pass over the running configuration and content data, bounded by a
time budget, with a mandatory coverage statement.

**Independent Test**: Seed a project with known defects (a broken relation, a missing media reference,
an empty required field), run the QA pass, confirm each is reported with its location and a plausible
fix, and that no data changed.

**Depends on**: US5 (`audit` mode selects the tool).

### Implementation for User Story 7

- [ ] T079 [US7] Create the QA service with the seven read-only checks from R7 â€” required field empty on an existing entry, relation pointing at a missing document, media field referencing a missing file, value outside an enumeration, component usage that cannot render, single type never created, published entry failing its own required fields â€” and export it from server/src/services/index.ts, in server/src/services/audit-qa.ts
- [ ] T080 [US7] Add the `audit.timeBudgetSeconds` deadline, the per-content-type sample cap (`maxEntriesPerType` default 50, max 200), and the mandatory `coverage` block listing `inspected`, `skippedForPermissions`, and `skippedForBudget` (FR-043, FR-044), in server/src/services/audit-qa.ts
- [ ] T081 [US7] Add the `runQaScan` tool, built only in `audit` mode, with a description that forbids speculative findings so a clean project returns `findings: []` (FR-045), in server/src/services/tools.ts
- [ ] T082 [US7] Render the audit report â€” findings grouped by severity with counts, location, impact, remediation, and the coverage statement â€” in admin/src/components/MessageList.tsx
- [ ] T083 [US7] Verify US7 in a real admin panel â€” scenario 8 of specs/001-preview-chat-attachments-audit/quickstart.md (seeded defects reported, nothing modified, permission-limited coverage listed, clean type reports nothing, budget respected)

**Checkpoint**: The QA pass reports concrete defects and states honestly what it did not reach.

---

## Phase 10: User Story 8 - Audit the plugin and API surface for security problems (Priority: P8)

**Goal**: A permission-gated, strictly read-only configuration audit whose evidence is masked at the
tool boundary, so nothing key-shaped ever reaches the model, the transcript, or a log line.

**Independent Test**: As a super-admin, run the audit on a project with a deliberately over-permissive
public role and a debug flag enabled, and confirm both are reported with remediation. As an editor
without `audit.run`, confirm the audit is refused and no findings leak.

**Depends on**: US5 (`audit` mode) and US7 (the report shape and rendering).

### Implementation for User Story 8

- [ ] T084 [US8] Create the security service covering the five areas of FR-046 â€” public/unauthenticated content-API exposure, create/update/delete/publish granted to the public role, roles holding permissions outside their stated scope, upload rules accepting executable or script types, `showProviderErrorDetails` and other debug settings, secret-like values in content fields or configuration â€” and export it from server/src/services/index.ts, in server/src/services/audit-security.ts
- [ ] T085 [US8] Pass every `evidence` value through server/src/services/redact.ts **before the result leaves the tool**, so a secret appears only as a mask plus its location (FR-049, Constitution I), in server/src/services/audit-security.ts
- [ ] T086 [US8] Add the `runSecurityAudit` tool gated on the caller's live `audit.run` ability, refusing with `{ ok:false, error:'permission_denied' }` and no counts, categories, or partial findings (FR-048), in server/src/services/tools.ts
- [ ] T087 [US8] State in the audit prompt section that remediations are advice and that applying one goes through `proposeChanges` and the normal permission checks (FR-050) in server/src/services/prompt.ts
- [ ] T088 [US8] Verify US8 in a real admin panel â€” quickstart scenario 9, plus permission-denied path 6 from contracts/permissions.md, searching the whole report and the host server log for zero plaintext occurrences of the seeded fake key

**Checkpoint**: All eight user stories are independently functional.

---

## Phase 11: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, edge cases spanning stories, and the release gate.

- [ ] T089 [P] Document the new `audit.run` permission, the preview configuration and front-end contract, thread privacy including the deliberate lack of a super-admin exemption, and the accepted v1 limitations (no GraphQL overlay, single-instance staged media, held attachments lost on reload, audits never read project source files) in README.md
- [ ] T090 [P] Add the new UI strings for the sidebar, mode selector, plan card, preview panel, and audit report in admin/src/translations/en.json
- [ ] T091 Add the expiry sweep that resolves overdue pending change sets and revokes overdue preview sessions with their staged bytes in server/src/services/change-sets.ts and server/src/services/preview.ts
- [ ] T092 Keep `sequence` consistent when the same user sends from two browser tabs of one thread so neither reply is lost or interleaved, in server/src/services/threads.ts
- [ ] T093 Render history for a thread that references a removed content type and explain the reference is gone, in admin/src/components/MessageList.tsx
- [ ] T094 Make every new failure an actionable message with no credential, raw provider text, or internal error (FR-053) across server/src/controllers/threads.ts, server/src/controllers/change-sets.ts, server/src/controllers/attachments.ts, and server/src/controllers/preview.ts
- [ ] T095 Run `pnpm run typecheck` clean and `pnpm run build`, and stage the rebuilt dist/ with the source change (Constitution IV)
- [ ] T096 Execute the full quickstart.md script (scenarios 1â€“10 including upgrade safety and provider switching) and all ten permission-denied paths, then complete the sign-off checklist in specs/001-preview-chat-attachments-audit/quickstart.md

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies â€” start immediately
- **Foundational (Phase 2)**: depends on Setup â€” **blocks every user story**
- **US1 (Phase 3)**: depends on Foundational only â€” the MVP
- **US2 (Phase 4)**: depends on US1 (renders a pending change set) â€” genuine dependency, not optional
- **US3 (Phase 5)**: depends on Foundational only â€” can run in parallel with US1/US2
- **US4 (Phase 6)**: depends on Foundational (turn persistence, T017) â€” can run in parallel with US1â€“US3
- **US5 (Phase 7)**: depends on US1 (`proposeChanges` must exist to be withheld in `audit` mode)
- **US6 (Phase 8)**: depends on US1 (approval defines the moment of ingestion); enriches US2 staged media
- **US7 (Phase 9)**: depends on US5 (`audit` mode selects the tool)
- **US8 (Phase 10)**: depends on US5 and US7 (mode plus the shared report shape)
- **Polish (Phase 11)**: depends on all shipped stories

### User Story Dependency Graph

```text
Foundational â”€â”€â”¬â”€â”€â–¶ US1 (P1) â”€â”€â”¬â”€â”€â–¶ US2 (P2)
               â”‚               â”œâ”€â”€â–¶ US5 (P5) â”€â”€â–¶ US7 (P7) â”€â”€â–¶ US8 (P8)
               â”‚               â””â”€â”€â–¶ US6 (P6) â”€â•Œâ•Œâ–¶ (enriches US2 preview media)
               â”œâ”€â”€â–¶ US3 (P3)
               â””â”€â”€â–¶ US4 (P4)
```

US3 and US4 are fully independent of the US1 chain and can ship in any order relative to it.

### Within Each User Story

- Content types before services; services before controllers; controllers before routes
- Server contract before the admin surface that calls it
- Core implementation before integration into `Chat.tsx`
- The story's verification task last â€” it is the story's definition of done

### Parallel Opportunities

- **Setup**: T002 and T003 in parallel (T001 â†’ T004 are sequential on config)
- **Foundational**: T005â€“T008 (four schema files) in parallel; then T010, T011, T012 in parallel with each other and with T018
- **US1**: T029 and T030 in parallel (different admin files) while the server chain T020 â†’ T022 proceeds
- **US2**: T037 and T039 touch different files and can proceed once T035 lands
- **US3**: T051 in parallel with the server chain T045 â†’ T048
- **US5**: T065 in parallel with T062 â†’ T064
- **US6**: T075 in parallel with the server chain T068 â†’ T071
- **Polish**: T089 and T090 in parallel
- **Cross-story**: once Foundational completes, US1, US3, and US4 can be worked by three people at once

---

## Parallel Example: Foundational

```bash
# Four independent schema files:
Task: "Create the chat-thread schema in server/src/content-types/chat-thread/schema.json"
Task: "Create the chat-message schema in server/src/content-types/chat-message/schema.json"
Task: "Create the change-set schema in server/src/content-types/change-set/schema.json"
Task: "Create the preview-session schema in server/src/content-types/preview-session/schema.json"

# Then three independent cross-cutting pieces:
Task: "Add preview token signing in server/src/services/crypto.ts"
Task: "Register the audit.run action in server/src/bootstrap.ts"
Task: "Add the has-audit-permission policy in server/src/policies/has-audit-permission.ts"
```

## Parallel Example: User Story 1

```bash
# Admin surface, while the server chain proceeds:
Task: "Create the change-set hook in admin/src/hooks/useChangeSet.ts"
Task: "Create the plan card in admin/src/components/ChangePlanCard.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1: Setup (T001â€“T004)
2. Phase 2: Foundational (T005â€“T019) â€” **blocks everything**
3. Phase 3: User Story 1 (T020â€“T034)
4. **STOP and VALIDATE**: T034 â€” quickstart scenarios 1 and 2 plus denied paths 1, 2, 4
5. Ship. At this point the assistant physically cannot write without approval, which is the whole
   safety premise of the feature.

### Incremental Delivery

1. Setup + Foundational â†’ conversations persist, owner-scoped
2. **+ US1** â†’ nothing is written without approval (MVP, tag a release)
3. **+ US3** â†’ the panel has a memory (highest daily-frustration win, independent of US1)
4. **+ US4** â†’ Stop actually stops the server
5. **+ US2** â†’ proposed values render on the real front-end
6. **+ US5** â†’ modes narrow the tool set; unlocks the audits
7. **+ US6** â†’ deferred ingestion; the Media Library stops collecting abandoned files
8. **+ US7** â†’ QA pass
9. **+ US8** â†’ security audit
10. Polish â†’ README, expiry sweep, full quickstart, release gate

Each increment is a shippable state; each ends with `pnpm run typecheck`, `pnpm run build`, and a
staged `dist/`.

### Parallel Team Strategy

With three developers, after Foundational:

- Developer A: US1 â†’ US2 (the change-set chain)
- Developer B: US3 â†’ US4 (persistence and generation control)
- Developer C: US5 â†’ US7 â†’ US8 (modes and audits), starting once US1's `proposeChanges` lands

US6 goes to whoever finishes first; it touches `tools.ts`, `change-sets.ts`, and `Composer.tsx`, so it
should not run concurrently with US1's server chain.

---

## Notes

- **No test tasks by design** â€” Constitution V makes `pnpm run typecheck` plus the manual quickstart the
  gate. Tasks T034, T044, T055, T060, T067, T078, T083, T088, and T096 are the verification tasks; each
  names the scenario and denied paths it must exercise.
- **One task per commit**, conventional imperative subject, committed directly to `main`, authored solely
  by the maintainer with no `Co-Authored-By` trailer.
- `dist/` is rebuilt and staged with every source change â€” stale `dist/` is a shipped regression.
- Every permission-denied path in contracts/permissions.md is claimed by exactly one verification task,
  so the required set of ten is covered by the time T096 runs: paths 1, 2, 4 (T034), 9, 10 (T044),
  3 (T055), 7 (T067), 5 (T078), 6 (T088), and 8 (T096, re-verified as existing behaviour).
- `[P]` means different files and no dependency on an incomplete task.
- Tasks touching server/src/services/ or server/src/routes/ re-check the two NON-NEGOTIABLE principles
  (secrets, RBAC) before commit.
