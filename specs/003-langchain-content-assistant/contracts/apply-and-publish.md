# Contract: Apply & Publish

**Feature**: `specs/003-langchain-content-assistant` | Covers FR-044..FR-052, FR-038..FR-043

`POST /ai-content-studio/change-sets/:id/apply` remains the **only** path in this plugin that mutates
content, and it remains plain deterministic server code reached from the editor's click. The model is
not involved in it.

---

## 1. Why publish lives inside apply

Three requirements pin it there (research D14):

- FR-050 wants **one** per-item report stating what was written *and* whether it was published,
  persisted into the transcript so a reload replays it. Two routes would split one outcome across two
  transcript entries.
- FR-049 wants an item whose target moved on to be **neither applied nor published** — one decision
  with two effects.
- A second route would re-enter the gate on a set that is already `applied`, which the existing
  `not_pending` rule correctly refuses.

So publish is a **second phase of the same call**, after the write phase, and it cannot be reached
independently.

---

## 2. Request

```json
{
  "itemIds": ["…"],
  "confirmDestructive": false,
  "attachmentResolutions": { "1": 42 },
  "publish": true,
  "confirmPublish": true
}
```

| Field | Change | Rules |
|---|---|---|
| `itemIds` | unchanged | at least one |
| `confirmDestructive` | unchanged | still **separately and additionally** required for items that remove content (FR-048) |
| `attachmentResolutions` | unchanged | ordinal → Media Library id |
| `publish` | **new** | `true` only from the Approve & Publish action |
| `confirmPublish` | **new** | must be `true` when `publish` is `true`, else `409 publish_confirmation_required` — **nothing is written and nothing is published** |

`confirmPublish` is refused **at the top of the gate**, before any write. A single activation of the
risky action must publish nothing *and* write nothing — otherwise "activate once, then navigate away"
would leave content changed (US6-7).

---

## 3. The gate — now seven steps

The existing six, in order, plus one:

1. Set is owned, `pending`, and not expired.
2. Every `itemId` exists in the set and is not `denied`.
3. **New**: `publish` requires `confirmPublish`.
4. Destructive items require `confirmDestructive`.
5. Every attachment-fed item has a resolution.
6. Per-item RBAC re-check against the caller's **live** ability (write phase).
7. `baseFingerprint` re-check per field → `stale`, writing nothing for that item.

Steps 1-5 are all-or-nothing refusals. Steps 6-7 are per item and produce outcomes.

---

## 4. Write phase — unchanged

`create` / `update` / `publish` / `ingestAttachment` behave exactly as before, producing
`ChangeItemOutcome.state` of `applied | blocked | stale | failed`. Per-field staleness still means an
unrelated edit elsewhere in the document does not block an item, while a genuine conflict on the same
field always does.

A `publish` **item** the assistant itself proposed keeps working as before — that path is not
removed, and the pre-existing approve actions behave exactly as they did (FR-051, US6-6).

---

## 5. Publish phase — new

Runs only when `publish === true`. Operates on **distinct documents**, not items:

```text
targets = distinct (contentTypeUid, documentId) of items whose write outcome is `applied`
          — excluding items whose operation was already `publish`

for each target:
  usesDraftAndPublish(uid) === false  -> not_applicable   ("live on save", no publish attempted)
  can(uid, 'publish', ability) false  -> blocked           (permission reason)
  else try publish(documentId)        -> published
       catch                          -> failed            (the host's reason)

attribute each target's result to every contributing item as outcome.publish
items whose write outcome is not `applied` -> outcome.publish = { state: 'skipped' }
```

| Rule | Requirement |
|---|---|
| Permission checked **per document, at the moment of application**, against the caller's live ability | FR-046 |
| `publish` is a **separate action** from the `update` already checked — never inherited from it | FR-046, Principle II |
| A publish the caller may not perform is reported **blocked with its reason**, never skipped silently | FR-046 |
| A non-draft-and-publish target is reported **live on save**; no publish is attempted | FR-047 |
| A `stale`, `blocked` or `failed` write never causes a publish | FR-049 |
| One document = one publish call, however many items touched it; its outcome is reported **per item** | FR-050 |
| A publish the host refuses (e.g. required fields empty) is `failed` with the host's reason, and the field write's outcome is reported **separately and accurately** | edge case |

**Ordering**: every write completes before any publish. A document is never published against a
half-written draft.

---

## 6. Response and status

```json
{
  "ok": true,
  "status": "partially_applied",
  "appliedAt": "2026-09-07T10:12:31.000Z",
  "items": [
    { "id": "i1", "outcome": { "state": "applied", "oldValue": "…", "newValue": "…",
                               "publish": { "state": "published" } } },
    { "id": "i2", "outcome": { "state": "applied", "newValue": "…",
                               "publish": { "state": "blocked",
                                            "message": "Your account cannot publish api::page.page." } } },
    { "id": "i3", "outcome": { "state": "stale", "message": "… changed since the plan was generated.",
                               "publish": { "state": "skipped" } } }
  ]
}
```

**Status derivation** (FR-052): `applied` only when every selected item's write reached `applied`
**and** every publish outcome is `published` or `not_applicable`. Anything else — a blocked publish
included — is `partially_applied`. A mixed outcome is reported as partially applied, never as a
success.

The set records `publishRequested` and `publishConfirmed`. Any transition out of `pending` still
revokes the set's previews.

New error codes:

| Code | Status | Meaning |
|---|---|---|
| `publish_confirmation_required` | `409` | `publish: true` without `confirmPublish: true` |

Existing codes and their statuses are unchanged, and the risky action on an expired or
already-resolved plan is refused with the **same** explanation as the existing approve actions.

---

## 7. The plan card

`admin/src/components/ChangePlanCard.tsx`. Built from `@strapi/design-system` v2 only.

| Element | Behaviour |
|---|---|
| Approve all / Approve selected / Reject / Select all | **unchanged in behaviour and appearance** (FR-051) |
| **Approve & Publish (Risky)** | Visually distinct — danger variant — and labelled to signal its risk (FR-044). Never styled as the safe default |
| Its confirmation | Required before anything happens; a single activation publishes nothing (FR-045) |
| Destructive confirmation | Still separate, still additionally required when the selection contains destructive items (FR-048) |
| Dismissing the confirmation, or navigating away | Nothing applied, nothing published (US6-7) |
| Disabled when | `busy`, expired, resolved, or no allowed items selected — same conditions as the existing actions |

### The confirmation text must state both consequences

```text
Publishing makes this content publicly visible immediately.

It publishes each affected document's ENTIRE current draft — not only the fields this plan
reviewed. Any unreviewed draft edit already sitting on those documents will go live with it.

Documents to publish: <n>
```

The second paragraph is not optional. Document-scoped publication is the **one consequence of this
action that is invisible in the plan's own before/after rows**, which is exactly why FR-045 requires
it be said before the editor commits.

### Report

The per-item report is appended to the conversation and persisted on the thread, so the outcome sits
in the transcript rather than in a toast, and a reload replays it (FR-050, US6-8). Each row states
what was written and, when the publish phase ran, whether the document was published — with the
reason whenever either was refused.

---

## 8. Copy controls

Grouped here because they share the transcript surface. Covers FR-038..FR-043.

| Element | Behaviour |
|---|---|
| Per assistant message | A copy control placing that message's **Markdown source** on the clipboard — the `text` parts joined, which is the source as authored (FR-038) |
| Per code block | A control copying **only** that block's contents, without surrounding prose (FR-039) |
| Confirmation | Brief and visible on success; an **explicit message** on failure — never a silent no-op (FR-040) |
| Keyboard and screen reader | A real focusable `button`, English `aria-label`, operable without a pointer, outcome announced via `role="status"` (FR-041) |
| After a reload | Identical behaviour on a restored conversation — the source is the stored `parts` either way (FR-042) |
| A message that is only a structured card | Either a readable plain-text rendering of the card, or **no control at all**. Never a control that copies nothing (FR-043) |
| While still streaming | Either unavailable until the turn finishes, or it copies exactly what has arrived. It never copies a partial value while presenting it as complete |

**Clipboard mechanics** (research D13): attempt `navigator.clipboard.writeText`; on absence or
rejection fall back to a hidden textarea plus `document.execCommand('copy')`; if that also fails,
show the explicit failure. The fallback matters because `navigator.clipboard` requires a secure
context, and a Strapi admin panel served over plain HTTP on a LAN host is not one — common enough in
self-hosted deployments that a single-path implementation would simply appear broken.
