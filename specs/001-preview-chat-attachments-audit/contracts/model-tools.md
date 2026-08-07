# Contract: Model-facing tools

**Feature**: [../spec.md](../spec.md) | **Date**: 2026-08-07

The tool set is rebuilt per request from `(caller ability, mode)`. Every tool keeps the four existing
rules from `services/tools.ts`: validate the uid against the live `api::*` allow-list, RBAC-check the
**caller's** ability before touching the Document Service, return compact JSON with long fields
truncated, and return structured `{ ok: false, error, message }` instead of throwing.

## Availability by mode

| Tool | `content` | `layout` | `audit` | Writes content |
|------|:---------:|:--------:|:-------:|:--------------:|
| `listContentTypes` | ✅ | ✅ | ✅ | no |
| `searchEntries` | ✅ | ✅ | ✅ | no |
| `getEntry` | ✅ | ✅ | ✅ | no |
| `describePageStructure` | — | ✅ | ✅ | no |
| `proposeChanges` | ✅ | ✅ | **—** | **no** (creates a pending plan) |
| `runQaScan` | — | — | ✅ | no |
| `runSecurityAudit` | — | — | ✅ (permission-gated) | no |

`createEntry`, `updateEntry` and `publishEntry` are **removed**. No tool in any mode can modify
content; the only write path is `POST /change-sets/:id/apply`, driven by the user (FR-001, FR-029).

---

## Unchanged tools

`listContentTypes`, `searchEntries`, `getEntry` keep their current input schemas and result shapes.

---

## `describePageStructure`

Supports layout instructions by reporting where media and links can go (FR-030).

```jsonc
// input
{ "contentTypeUid": "api::page.page", "documentId": "abc123" }   // documentId optional for single types
// result
{ "ok": true, "documentLabel": "Homepage",
  "sections": [ { "path": "hero", "component": "sections.hero", "repeatable": false,
                  "slots": [ { "field": "hero.image", "type": "media", "multiple": false,
                               "currentValue": "id 88 — hero-old.jpg" },
                             { "field": "hero.cta.url", "type": "string", "currentValue": null } ] },
                { "path": "sections[1]", "component": "sections.info", "repeatable": true,
                  "slots": [ … ] } ] }
```

Read-only, RBAC-gated on `read` for the target type. Ambiguity is reported, not resolved: if a page has
several media slots that could match "the hero image", all candidates are returned so the assistant can
ask instead of guessing (FR-035).

---

## `proposeChanges`

The only way the assistant can affect content, and it affects nothing until the user approves.

```jsonc
// input
{ "summary": "Update the homepage hero headline and swap the hero image",
  "items": [
    { "operation": "update", "contentTypeUid": "api::page.page", "documentId": "abc123",
      "field": "hero.headline", "proposedValue": "Bathrooms built around you" },
    { "operation": "update", "contentTypeUid": "api::page.page", "documentId": "abc123",
      "field": "hero.image", "attachmentOrdinal": 1 },
    { "operation": "publish", "contentTypeUid": "api::page.page", "documentId": "abc123" }
  ] }
```

Server-side, before returning, for each item: validate the uid and the field path; RBAC-check the
caller for the item's action; read the current value; compute `baseFingerprint`; derive `destructive`
and `resultingState`; and, for `attachmentOrdinal`, confirm the ordinal exists in this turn's manifest.
Then persist one `change-set` with `status: "pending"`.

```jsonc
// result
{ "ok": true, "changeSetId": "cs_…", "status": "pending", "expiresAt": "…",
  "requiresDestructiveConfirmation": false,
  "items": [ { "id": "i1", "field": "hero.headline", "currentValue": "Beautiful bathrooms",
               "proposedValue": "Bathrooms built around you", "resultingState": "draft",
               "permissionVerdict": "allowed", "destructive": false },
             { "id": "i2", "field": "hero.image", "attachmentOrdinal": 1,
               "currentValue": "id 88 — hero-old.jpg", "proposedValue": "attachment #1 — hero.jpg",
               "resultingState": "draft", "permissionVerdict": "allowed", "destructive": false } ],
  "blocked": [ { "field": "seo.title", "reason": "permission_denied",
                 "message": "Your account cannot update api::page.page." } ],
  "nextStep": "The user reviews this plan in the panel and approves or rejects it. You cannot apply it." }
```

Contract details that matter:

- Items the caller may not perform are returned in `blocked`, never silently dropped (FR-004, US1-5).
- `nextStep` is part of the result so the model does not claim the change was made; the system prompt
  reinforces it.
- Unmappable instructions (an attachment with no target, a field the assistant could not resolve) come
  back as `{ ok: false, error: 'unresolved_placement', message, candidates: [...] }` so the assistant
  asks rather than guesses (FR-035).
- An empty `items` array is `{ ok: false, error: 'empty_plan' }` — the assistant says no change is
  needed instead of showing an empty plan (edge case).

---

## `runQaScan`

```jsonc
// input
{ "contentTypeUids": ["api::page.page"],   // optional; default = every readable type
  "maxEntriesPerType": 50 }                 // optional, default 50, max 200
```

Result is the Audit Report shape in [../data-model.md](../data-model.md#audit-report--finding-transient)
with `kind: "qa"`. Read-only (FR-042). Skips content types the caller cannot read and lists them under
`coverage.skippedForPermissions` (FR-043). Stops at `audit.timeBudgetSeconds` and lists what it did not
reach under `coverage.skippedForBudget` (FR-044). A clean project returns
`findings: []` — the tool description forbids speculative findings (FR-045).

Checks: required-field-empty, dangling relation, missing media file, enum out of range, broken component
usage, single type never created, published entry failing its own required fields (see
[../research.md](../research.md#r7--what-exactly-does-the-qa-scan-check)).

---

## `runSecurityAudit`

```jsonc
// input
{ "areas": ["permissions", "endpoints", "uploads", "settings", "content-secrets"] }  // optional, default all
```

Gating, in order: `audit` mode ⇒ tool is built at all; caller holds
`plugin::ai-content-studio.audit.run` ⇒ otherwise the tool returns
`{ ok: false, error: 'permission_denied', message: 'Your account is not allowed to run the security audit.' }`
with **no findings and no counts** (FR-048).

Result is the Audit Report shape with `kind: "security"`. Read-only; remediations are advice only, and
if the user asks to apply one it goes through `proposeChanges` like any other change (FR-050).

**Masking (FR-049, Constitution I)**: every `evidence` value passes the shared redaction helper before
the result leaves the tool, so a secret-like value is reported as its location plus a mask
(`sk-ant-...••••4f2a`) and never as plaintext — the provider never receives it, and it never lands in
the persisted transcript.

---

## System prompt changes

The prompt is composed from a shared base plus a mode section. Required edits to today's prompt:

- **Remove** the write instructions ("Before a write (createEntry / updateEntry / publishEntry)…",
  "After EACH write, report the outcome…") — there are no write tools. Replace with: propose a plan,
  state plainly that nothing has changed yet, and let the user approve in the panel.
- **Replace** the media-id workflow with the attachment-manifest workflow: refer to attachments by
  ordinal (`#1`) and set media fields with `attachmentOrdinal`, not a library id (FR-034).
- **Drop the hardcoded project-specific field map** (`blog-post.featuredImage`, `homepage hero.slides[]`
  and friends). Those names belong to one consuming project and are wrong everywhere else; use
  `describePageStructure` instead. This also removes "Concept Bath" from the prompt identity so the
  plugin is neutral for all consumers.
- **Keep** the permission-denied guidance (do not retry) and the Markdown/style rules.
- **Add** for `audit` mode: read-only, report findings with location and severity, never invent
  findings, never reproduce a secret value.
