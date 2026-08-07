# Phase 1 Data Model

**Feature**: [spec.md](./spec.md) | **Research**: [research.md](./research.md) | **Date**: 2026-08-07

Four persisted plugin content types, plus two deliberately non-persisted structures. All persisted
types are hidden from the Content Manager and have draft & publish **off**:

```jsonc
"pluginOptions": { "content-manager": { "visible": false }, "content-type-builder": { "visible": false } },
"options": { "draftAndPublish": false }
```

| Structure | Storage | Lifetime |
|-----------|---------|----------|
| `chat-thread` | plugin content type | until the owner deletes it, or their admin account is removed |
| `chat-message` | plugin content type | with its thread |
| `change-set` | plugin content type | with its thread; `pending` sets expire after `preview.ttlMinutes` |
| `preview-session` | plugin content type | `preview.ttlMinutes`, or until its change set resolves |
| Staged preview file | server memory (creating instance) | with its preview session; lost on restart |
| Held attachment | browser memory | current panel session of the conversation |

---

## chat-thread

`plugin::ai-content-studio.chat-thread` — one conversation, owned by exactly one admin user.

| Field | Type | Rules |
|-------|------|-------|
| `title` | string | required; auto-generated from the first exchange (≤ 60 chars), user-overridable |
| `ownerId` | integer | required, indexed; the admin user id, taken from `ctx.state.user.id` — **never** from the request body |
| `mode` | enumeration `content` \| `layout` \| `audit` | required, default `content` |
| `lastActivityAt` | datetime | required; set on every message append and on apply/reject |
| `contextSummary` | text | nullable; running summary of condensed older turns (R9) |
| `summarizedThroughMessageId` | string | nullable; the last message covered by `contextSummary` |

**Relations**: has many `chat-message`; has many `change-set`.

**Access rule (FR-017)**: every read/write is scoped by `ownerId === ctx.state.user.id`. A thread id
belonging to another user resolves as **404, not 403**, so ids are not enumerable. Super-admin is not
exempt.

**Cascade (FR-022)**: deleting a thread deletes its messages, its change sets, its preview sessions,
and drops any staged files for those sessions.

---

## chat-message

`plugin::ai-content-studio.chat-message` — one turn, stored in the shape the chat UI replays.

| Field | Type | Rules |
|-------|------|-------|
| `thread` | relation → `chat-thread` | required |
| `role` | enumeration `user` \| `assistant` | required |
| `sequence` | integer | required; monotonic per thread, defines order |
| `parts` | json | required; the message's UI parts (text, tool calls and results, file references) |
| `attachmentManifest` | json | nullable; `[{ ordinal, filename, mimeType, sizeBytes }]` for user turns (R5) |
| `interrupted` | boolean | default `false`; `true` for a stopped generation (FR-024) |
| `modeAtSend` | enumeration | required; the mode in force for this turn, so history stays readable after a mode switch |
| `changeSet` | relation → `change-set` | nullable; set when the turn produced a plan |

**Rules**: `parts` never stores attachment bytes or data URLs — only the manifest and, after
ingestion, Media Library ids (R5). Tool results stored in `parts` are the same masked/truncated values
the model received, so replaying history cannot surface a secret the live call withheld (FR-049).

---

## change-set

`plugin::ai-content-studio.change-set` — one plan. Items are a JSON array, not a separate type (R3).

| Field | Type | Rules |
|-------|------|-------|
| `thread` | relation → `chat-thread` | required |
| `ownerId` | integer | required, indexed; denormalised for direct authorization on apply |
| `status` | enumeration | required; see state machine below; default `pending` |
| `items` | json | required; array of Change Item (below); non-empty |
| `expiresAt` | datetime | required; created + `preview.ttlMinutes` |
| `proposedAt` | datetime | required |
| `resolvedAt` | datetime | nullable; when applied / rejected / expired |
| `approvedByUserId` | integer | nullable; recorded on apply (FR-008) |
| `approvedItemIds` | json | nullable; the subset the user approved (FR-003) |
| `destructiveConfirmed` | boolean | default `false`; required `true` before any destructive item applies (FR-007) |

### Change Item (element of `items`)

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | stable within the set; what the UI approves by |
| `operation` | `create` \| `update` \| `publish` \| `ingestAttachment` | |
| `contentTypeUid` | string | validated against the live `api::*` allow-list |
| `documentId` | string \| null | null for `create` and for single types |
| `documentLabel` | string | human title for the plan and the report |
| `field` | string \| null | dotted path for component fields; null for `publish` |
| `currentValue` | json | truncated for display; null for `create` |
| `proposedValue` | json | truncated for display |
| `resultingState` | `draft` \| `published` \| `unchanged` | FR-002 |
| `destructive` | boolean | clears a field, removes a relation, or deletes content (FR-007) |
| `attachmentOrdinal` | integer \| null | set for `ingestAttachment` and for media fields fed by an attachment |
| `permissionVerdict` | `allowed` \| `denied` | evaluated at propose **and** re-evaluated at apply (FR-004) |
| `baseFingerprint` | object \| null | `{ updatedAt, fieldHash }` captured at propose time (R10) |
| `outcome` | object \| null | after apply: `{ state: applied \| blocked \| stale \| failed \| skipped, message?, oldValue?, newValue? }` |

**Validation**: `contentTypeUid` must be in the live allow-list; `field` must exist on that type;
`ingestAttachment` items must carry an `attachmentOrdinal` present in the turn's manifest; an item
whose `permissionVerdict` is `denied` cannot be approved.

### State machine

```text
pending ──approve(all|subset)──▶ applied            (every approved item succeeded)
        │                     ╰▶ partially_applied  (≥1 approved item blocked/stale/failed)
        ├──reject────────────▶ rejected
        └──ttl elapsed───────▶ expired
```

`pending` is the only state that accepts apply or reject, which makes a repeated approval a no-op
rather than a second write (R10, FR-009). Any transition out of `pending` invalidates the set's
preview sessions (FR-012) and sets `resolvedAt`.

---

## preview-session

`plugin::ai-content-studio.preview-session` — a short-lived, owner-only view of one change set.

| Field | Type | Rules |
|-------|------|-------|
| `changeSet` | relation → `change-set` | required |
| `ownerId` | integer | required, indexed |
| `sessionId` | uid | required, unique; the public handle inside the token |
| `overlay` | json | required; precomputed `{ [contentTypeUid]: { [documentId]: { [field]: value } } }` for fast middleware application |
| `stagedFiles` | json | nullable; `[{ fileId, ordinal, filename, mimeType, sizeBytes }]` — metadata only, bytes live in memory |
| `expiresAt` | datetime | required; created + `preview.ttlMinutes` |
| `revokedAt` | datetime | nullable; set when the change set resolves or the user rejects |
| `targetUrl` | string | required; the front-end URL the panel opens |

**Token (R11)**: not stored. `HMAC-SHA256({ sessionId, ownerId, changeSetId, exp })` under a labelled
subkey of `AI_STUDIO_ENC_KEY`. The middleware verifies the HMAC before any database lookup, then
checks `expiresAt` / `revokedAt`. A session is valid only while its change set is `pending`.

**Overlay semantics**: applied to REST content-API responses only; matches on `contentTypeUid` +
`documentId`; a media field fed by an attachment is replaced with a media-shaped object carrying a
**negative `id`** and a staged-file URL, so nothing can mistake it for a library entry (R2).

---

## Non-persisted structures

### Held attachment (browser memory)

`{ ordinal, file: File, filename, mimeType, sizeBytes, validation: 'ok' | 'too-large' | 'rejected', ingestionState: 'held' | 'staged' | 'ingested' | 'discarded' }`

Ordinals are 1-based, stable for the conversation, and never reused after removal — "image #1" must
keep meaning the same file for the whole conversation (FR-034). Bytes never reach the server except
to stage a preview (R2) or to ingest after approval (R5). Total size is capped by
`attachments.totalBudgetMb`; a reload discards everything held and the restored thread says so
(FR-038).

### Audit report / finding (transient)

Not persisted in v1. A pass returns its report as the tool result and it is preserved only inside the
message's `parts`, which is what the history replay needs. Shape:

```jsonc
{
  "kind": "qa" | "security",
  "runAt": "<iso>",
  "coverage": { "inspected": ["api::…"], "skippedForPermissions": ["api::…"], "skippedForBudget": ["api::…"] },
  "counts": { "critical": 0, "high": 2, "medium": 5, "low": 1 },
  "findings": [{
    "category": "dangling-relation" | "missing-media" | "required-empty" | "enum-out-of-range" |
                "component-broken" | "single-type-missing" | "public-write-permission" |
                "unauthenticated-endpoint" | "role-overbroad" | "unsafe-upload-types" |
                "debug-setting" | "secret-like-value",
    "severity": "critical" | "high" | "medium" | "low",
    "location": { "contentTypeUid": "…", "documentId": "…", "field": "…", "configPath": "…" },
    "evidence": "masked string",
    "impact": "…",
    "remediation": "…"
  }]
}
```

Every `evidence` string passes the shared redaction helper **before** the result leaves the tool, so a
secret never reaches the provider, the transcript, or a log (FR-049, Constitution I). A `coverage`
block is mandatory: a pass that ran out of budget must not read as a clean bill of health (FR-044).

---

## Entity map

```text
admin user (1) ──owns──▶ chat-thread (n) ──▶ chat-message (n)
                              │
                              ╰──▶ change-set (n) ──▶ preview-session (n) ─╌╌▶ staged file (memory)
                                        │
                                        ╰─ items[] ─╌╌▶ held attachment (browser, by ordinal)
                                        ╰─ applied items ──▶ Strapi documents / Media Library entries
```

Solid arrows are persisted relations; dashed arrows cross a persistence boundary on purpose.
