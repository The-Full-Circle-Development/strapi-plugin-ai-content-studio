# Contract: Admin API

**Feature**: [../spec.md](../spec.md) | **Date**: 2026-08-07

All routes below are `type: 'admin'`, mounted under `/ai-content-studio/*`, and carry
`admin::isAuthenticatedAdmin`. Every route additionally requires the caller to hold
`plugin::ai-content-studio.chat.use` unless stated otherwise. Existing `GET/PUT /settings`
(super-admin only) are unchanged by this feature.

Conventions:

- Request and response bodies are JSON unless a route is marked **multipart**.
- Every body is validated with zod; a failure is `400` with `{ error, message }` and no echo of
  unvalidated input.
- Ownership is always derived from `ctx.state.user.id`. A resource owned by another user answers
  **`404`**, never `403`, so ids are not enumerable (FR-017).
- Errors never contain credentials or raw provider/internal messages (FR-053).

---

## Threads

### `GET /threads`

List the caller's own threads, most-recent-first.

Query: `?limit=<1..100, default 30>&cursor=<lastActivityAt iso>`

```jsonc
// 200
{ "threads": [ { "id": "…", "title": "Homepage hero copy", "mode": "content",
                 "lastActivityAt": "2026-08-07T10:12:00.000Z", "messageCount": 12 } ],
  "nextCursor": "2026-08-01T09:00:00.000Z" | null }
```

### `POST /threads`

```jsonc
// request
{ "mode": "content" | "layout" | "audit" }   // optional, default "content"
// 201
{ "id": "…", "title": "New conversation", "mode": "content", "lastActivityAt": "…" }
```

### `GET /threads/:id`

Thread plus full message history in order (FR-016). `parts` is returned in the shape the chat UI
replays directly.

```jsonc
// 200
{ "id": "…", "title": "…", "mode": "content", "contextCondensed": true,
  "messages": [ { "id": "…", "role": "user", "sequence": 1, "parts": [ … ],
                  "attachmentManifest": [ { "ordinal": 1, "filename": "hero.jpg",
                                            "mimeType": "image/jpeg", "sizeBytes": 482913 } ],
                  "interrupted": false, "modeAtSend": "content", "changeSetId": null } ],
  "expiredAttachments": [ { "messageId": "…", "ordinals": [1, 2] } ] }
```

`expiredAttachments` is what the UI needs to tell the user that held files were never ingested and can
be re-attached (FR-038). `contextCondensed: true` surfaces FR-021 in the UI.

### `PATCH /threads/:id`

```jsonc
{ "title": "Q3 landing page", "mode": "audit" }   // both optional
// 200 → the updated thread summary
```

### `DELETE /threads/:id`

Cascades to messages, change sets, preview sessions, and staged files (FR-022). `204`.

---

## Chat

### `POST /chat`

Streams the assistant turn. Replaces today's body shape.

```jsonc
// request
{ "threadId": "…",                       // required; must belong to the caller
  "mode": "content" | "layout" | "audit", // required; also persisted on the thread
  "messages": [ /* UIMessage[] — file parts only on the last message */ ],
  "attachmentManifest": [ { "ordinal": 1, "filename": "hero.jpg",
                            "mimeType": "image/jpeg", "sizeBytes": 482913 } ] }
```

Response: the UI message stream (unchanged transport), with
`Cache-Control: no-cache, no-transform`.

Behaviour:

- The mode selects the tool set; `audit` mode exposes no `proposeChanges` (FR-029).
- Image file parts are forwarded only when the active model supports vision; the manifest always
  reaches the model as text so placement works on any provider (FR-036).
- The user turn and the assistant turn are persisted; a client disconnect aborts the generation and
  persists the partial assistant message with `interrupted: true` (FR-023..FR-025).
- Config/key problems answer `400` **before** streaming starts, as today.

---

## Change sets

### `GET /change-sets/:id`

```jsonc
// 200
{ "id": "…", "threadId": "…", "status": "pending", "proposedAt": "…", "expiresAt": "…",
  "hasDestructive": true,
  "items": [ { "id": "i1", "operation": "update", "contentTypeUid": "api::page.page",
               "documentId": "abc123", "documentLabel": "Homepage", "field": "hero.headline",
               "currentValue": "Old headline", "proposedValue": "New headline",
               "resultingState": "draft", "destructive": false, "attachmentOrdinal": null,
               "permissionVerdict": "allowed", "outcome": null } ] }
```

### `POST /change-sets/:id/apply`

The only path from a proposal to the database. The model is not involved.

```jsonc
// request
{ "itemIds": ["i1", "i3"],              // required, non-empty; subset approval (FR-003)
  "confirmDestructive": false,           // required true if any approved item is destructive (FR-007)
  "attachmentResolutions": { "1": 412 } } // ordinal → Media Library id, from /attachments/ingest
```

Server-side gate, in order — a failure at any step applies **nothing** for that item:

1. change set is owned by the caller and `status === "pending"` and not expired (FR-009);
2. every `itemId` exists in the set and is not `permissionVerdict: "denied"`;
3. per-item RBAC re-check against the caller's live ability (FR-004);
4. `baseFingerprint` re-check → mismatch ⇒ `outcome.state = "stale"` (FR-005);
5. destructive items require `confirmDestructive: true` (FR-007);
6. every `ingestAttachment` / media item has an entry in `attachmentResolutions`.

```jsonc
// 200
{ "status": "applied" | "partially_applied",
  "approvedByUserId": 7, "appliedAt": "…",
  "items": [ { "id": "i1", "outcome": { "state": "applied", "oldValue": "Old headline",
                                        "newValue": "New headline" } },
             { "id": "i3", "outcome": { "state": "stale",
                                        "message": "Homepage changed since the plan was generated." } } ] }
```

The per-item outcomes are the source of the assistant's post-apply report (FR-006); the UI appends them
to the thread so the history stays auditable (FR-008).

### `POST /change-sets/:id/reject`

`204`. Sets `status: "rejected"`, revokes preview sessions, ingests nothing (FR-003, FR-012).

### `POST /change-sets/:id/preview` — **multipart**

Creates a preview session, optionally staging held attachment bytes so proposed media renders (FR-013).

```text
fields: targetContentTypeUid, targetDocumentId (optional — defaults to the set's first target)
files:  attachment[<ordinal>]  (optional, repeated)
```

```jsonc
// 200
{ "sessionId": "…", "token": "…", "previewUrl": "https://site.example/blog/x?aiStudioPreview=…",
  "expiresAt": "…", "stagedFiles": [ { "ordinal": 1, "fileId": "…" } ] }

// 409 — preview not available
{ "error": "preview_not_configured",
  "message": "No preview target is configured for api::page.page. Showing the field comparison instead.",
  "fallback": "field-diff" }
```

`409` with `fallback: "field-diff"` is the contracted way the panel learns to show the in-panel
before/after comparison instead of blocking approval (FR-014). Creating a preview never writes content
(FR-015).

---

## Attachments

### `GET /attachments/limits`

Lets the composer reject a file with the real reason *before* the message is sent (FR-032).

```jsonc
// 200
{ "sizeLimitBytes": 209715200, "totalBudgetBytes": 52428800, "acceptsAnyMimeType": true,
  "blockedMimeTypes": [] }
```

### `POST /attachments/ingest` — **multipart**

Called only after the user approves a plan containing ingestion, or explicitly asks to upload
(FR-033, FR-039). Requires the caller's Media Library create permission — checked before any byte is
written.

```text
fields: threadId, idempotencyKey[<ordinal>] = <sha256 of the file bytes>
files:  attachment[<ordinal>]
```

```jsonc
// 200
{ "ingested": [ { "ordinal": 1, "mediaId": 412, "name": "hero.jpg", "url": "/uploads/hero.jpg",
                  "deduplicated": false } ] }
// 403
{ "error": "permission_denied", "message": "Your account cannot upload to the Media Library." }
```

`(threadId, ordinal, idempotencyKey)` makes a retry return the existing `mediaId` with
`deduplicated: true` rather than creating a second file (FR-037).

---

## Route summary

| Method | Path | Permission | Writes content? |
|--------|------|-----------|-----------------|
| GET | `/threads` | `chat.use` | no |
| POST | `/threads` | `chat.use` | no |
| GET | `/threads/:id` | `chat.use` + owner | no |
| PATCH | `/threads/:id` | `chat.use` + owner | no |
| DELETE | `/threads/:id` | `chat.use` + owner | no |
| POST | `/chat` | `chat.use` + owner | **no** (proposals only) |
| GET | `/change-sets/:id` | `chat.use` + owner | no |
| POST | `/change-sets/:id/apply` | `chat.use` + owner + per-item content RBAC | **yes — the only write path** |
| POST | `/change-sets/:id/reject` | `chat.use` + owner | no |
| POST | `/change-sets/:id/preview` | `chat.use` + owner | no |
| GET | `/attachments/limits` | `chat.use` | no |
| POST | `/attachments/ingest` | `chat.use` + upload-create | Media Library only |
| GET | `/settings` | super-admin (unchanged) | no |
| PUT | `/settings` | super-admin (unchanged) | no |

Two non-admin surfaces exist for preview only and are specified separately in
[preview-integration.md](./preview-integration.md).
