# Data Model: Unified Provider Layer, Single Content Mode & Project-Grounded Prompt

**Feature**: `specs/003-langchain-content-assistant` | **Date**: 2026-09-07

Derived from the spec's Key Entities and the requirements that constrain each field. Types live in
`server/src/types.ts` unless noted. Nothing here is `any` in an exported signature.

**No model identifier appears in this document.** The curated lists have exactly one home,
`admin/src/data/models.ts` (`CLAUDE.md`).

---

## 1. Shipped provider (`ProviderDescriptor`)

One provider the adapter layer can reach **and** the distribution ships. Lives in
`server/src/services/providers.ts` — the only file that changes when a provider is added or dropped
(FR-002). The plugin *describes* providers; it does not implement them.

| Field | Type | Rules |
|---|---|---|
| `id` | `string` | Stable, lowercase, kebab-case. Persisted in settings and used as the map key. Never renamed once shipped — a rename orphans an install's saved selection. |
| `label` | `string` | English display name (FR-025). |
| `create` | `(input: { apiKey: string; model: string; baseUrl: string \| null }) => BaseChatModel` | Statically imported constructor, wrapped. The **only** provider-shaped code in the repository. Never a dynamic import (research D2). |
| `requiresBaseUrl` | `boolean` | `true` only for the OpenAI-compatible provider. When `true`, a saved configuration without a valid base URL is a configuration failure surfaced before generation (FR-010). |
| `supportsVision` | `(model: string) => boolean` | Declared per provider, **default-deny** (FR-006). Replaces the single prefix-matching `modelSupportsVision()`. The four rules are written out in [contracts/provider-layer.md](contracts/provider-layer.md) §3 and are **ported verbatim** from today's function — image input works on the three first-party providers now, and a descriptor left at bare default-deny would remove that silently. |
| `hasCuratedModels` | `boolean` | Derived, not stored: `MODELS[id] != null`. `false` means the settings screen offers direct identifier entry (FR-004). |

**Invariants**

- `id` values are unique and the table is the **allow-list for `activeProvider`**: an id absent from
  it is `UNKNOWN_PROVIDER`, refused before generation. An administrator cannot introduce a provider
  the layer does not know (FR-002).
- The table is **never** an allow-list for a model identifier. Any saved identifier is passed to the
  provider verbatim (FR-004, FR-005).
- `create` receives an already-decrypted key and returns immediately; it performs no network call, so
  a configuration error is distinguishable from a provider error (FR-010).
- Shipped set: `anthropic`, `openai`, `google`, `openai-compatible`. The first three keep their
  existing ids so no install's saved selection is orphaned.

---

## 2. Curated model entry (`ModelOption`) — unchanged

`{ id: string; label: string }` in `admin/src/data/models.ts`. Untouched by this feature in shape,
content and **formatting**: `.claude/hooks/session-model-context.mjs` parses that file as text and
scans to end of file, so nothing may be appended after the `MODELS` literal (research D15). The new
provider catalog lives in `admin/src/data/providers.ts` instead.

Its documented invariants still hold, with one consumer change: `Settings.tsx` must stop indexing
`MODELS[next][0].id` unguarded, because a shipped provider may legitimately have no curated list.

---

## 3. Persisted settings (`StudioSettings`)

Strapi plugin store, key `settings`. Raw settings including ciphertext **never** leave the server;
the only client-facing shape is `MaskedStudioConfig`.

| Field | Type | Change | Rules |
|---|---|---|---|
| `activeProvider` | `string` | widened from a literal union | Must be a `ProviderDescriptor.id`; otherwise `UNKNOWN_PROVIDER` (FR-002). |
| `activeModel` | `string` | unchanged | Passed to the provider **verbatim** — never normalized, lowercased or date-suffixed (FR-004, FR-005). |
| `providers` | `Record<string, ProviderState>` | widened from a fixed-key record | Unknown keys are **preserved** on read and write, so downgrading and re-upgrading does not silently discard a configuration. Only known ids are selectable. |
| `grounding` | `{ enabled: boolean }` | **new** | Defaults to `enabled: true` — deterministic, bounded, permission-filtered and inspectable, so it is safe for an existing install (FR-036). |

### `ProviderState`

| Field | Type | Change | Rules |
|---|---|---|---|
| `apiKeyEnc` | `string \| null` | unchanged | AES-256-GCM `"iv:authTag:ciphertext"` (base64). |
| `isSet` | `boolean` | unchanged | Derived on read from `apiKeyEnc != null` — never persisted as truth. |
| `enabled` | `boolean` | unchanged | |
| `baseUrl` | `string \| null` | **new** | Its **own field**, never merged into or rendered beside the credential (FR-008). Validated: absolute `http:`/`https:` URL, no credentials in the userinfo component, trailing slashes trimmed. Rejected input is a `400` naming the field. |

### `MaskedProviderState` (client-facing)

`{ isSet, enabled, masked, baseUrl }`. `masked` stays a mask only. `baseUrl` is **not** secret and is
returned in full — that is the point of keeping it a separate field: it can be shown, checked and
corrected without ever risking the key (FR-008).

**Normalization rules** (`config.ts`)

- A missing field takes its default; an upgrade never breaks an existing install.
- `isSet` is always recomputed from the ciphertext.
- An unknown provider key is carried through untouched but is never offered for selection.
- `getDecryptedKey` still decrypts **only** the requested provider.

---

## 4. Instruction set (`InstructionSet`)

The composed system instructions for one request. Assembled in `server/src/services/prompt.ts`.

| Field | Type | Rules |
|---|---|---|
| `version` | `string` | `v<N>-<first 8 hex of sha256(behavioural section text)>`, computed at module load. **Derived, not maintained** — editing the text changes it automatically, which is how FR-026 is satisfied structurally. The install description is excluded from the hash (research D10). |
| `text` | `string` | Sections concatenated in a fixed declared order. **Byte-for-byte identical for identical request inputs** (FR-018). |
| `sections` | `readonly InstructionSectionId[]` | Which sections were included, in order — the inspector renders this alongside the text. |
| `groundingIncluded` | `boolean` | False when grounding is off (FR-036) or when the caller can read nothing. |
| `groundingPartial` | `boolean` | True when the description was shortened to fit its budget (FR-032). |

**Request inputs** that may vary the composition — and nothing else may:

`{ supportsVision: boolean; hasAttachments: boolean; groundingEnabled: boolean; readableUids: string[]; schemaFingerprint: string; contextSummary: string | null }`

**Invariants**

- Names no consuming project; hard-codes no field name, content-type identifier or page structure
  (FR-020).
- English only (FR-025).
- The description occupies a clearly delimited section, marked as facts about this install, and is
  **explicitly subordinate** to the behavioural sections — a described structure never overrides a
  rule (FR-034).

---

## 5. Install description (`InstallDescription`)

Generated structural facts about the running project. Produced by `server/src/services/grounding.ts`.
Contains **no content, no entry values, no media URLs, no user data, nothing secret-like** (FR-029).

| Field | Type | Rules |
|---|---|---|
| `text` | `string` | The exact text embedded in the instructions, and the exact text the inspector shows (FR-035). |
| `partial` | `boolean` | True when a degradation tier below "full" was applied. |
| `tier` | `'full' \| 'no-components' \| 'names-only'` | Chosen by the same deterministic rule every time (FR-032). |
| `schemaFingerprint` | `string` | Hash over the canonically serialized `api::*` schemas plus components. Changes when the schema changes — the cache key that makes FR-033 work with no restart. |
| `readableFingerprint` | `string` | Hash of the caller's sorted readable-uid list. The only ability input that can change the output, so the pair is an exact cache key. |
| `charCount` | `number` | Must never exceed the declared budget (SC-011). |

### Described shape (per content type)

`uid`, `kind` (single/collection), `displayName`, `draftAndPublish`, `localized`, and per attribute:
`name`, `type`, `required`, `enum` values, relation `target` + cardinality, component reference +
`repeatable`. Plus: component structures, which fields hold media, and which content types have a
preview target configured (FR-027).

**Invariants**

- Derived **only** from the running instance's schema and the plugin's own configuration. It never
  reads, parses or analyses the host application's source code (FR-028).
- Deterministic: fixed section order, every list sorted lexicographically, no timestamps, no values
  that vary with content volume, no language model involved (FR-030).
- Limited to what the calling account may read, via the same live `can.read()` the tools use (FR-031).
- **Authorizes nothing.** Every read and every applied change is still checked against the caller's
  live permissions (FR-037), so a described content type can still come back blocked.
- Two accounts in the same install legitimately receive different descriptions; each is stable for
  that account and that schema.

---

## 6. Conversation and turn

### `chat-thread` — schema unchanged

`mode` (enumeration `content|layout|audit`, required, default `content`) becomes **vestigial**: no
longer read, no longer written. Left in place deliberately — removing a required column from live
consumer databases is a migration risk with no behavioural gain, and the spec's own assumption is
that legacy values are ignored rather than migrated (research D12). Documented as vestigial in the
schema's description so the next reader does not mistake it for live state.

### `chat-message`

| Field | Change | Rules |
|---|---|---|
| `parts` | **shape preserved** | AI SDK `UIMessage` parts. This is the contract that makes FR-013 hold: turns written before and after this change are the same shape, because both are assembled by the AI SDK's own assembler (research D5). Still never holds attachment bytes. |
| `promptVersion` | **new**, `string`, nullable | The `InstructionSet.version` that produced this turn (FR-019). Nullable because turns stored before this change have none — and a null is honest, where a backfilled guess would not be. |
| `modeAtSend` | **vestigial** | Required with default `content`; new rows take the default. Not read. |
| `attachmentManifest`, `interrupted`, `sequence`, `role`, `changeSet` | unchanged | |

**Replay invariant**: a stored turn referencing a mode, a tool or a report card that no longer exists
replays without error and **without implying the removed capability is still available**. A
`runQaScan` tool part renders as a generic tool pill once its card is deleted (research D11).

---

## 7. Change plan item (`ChangeItem`) — unchanged in shape, extended in outcome

`ChangeItem` itself is untouched: `id`, `operation`, `contentTypeUid`, `documentId`, `documentLabel`,
`field`, `currentValue`, `proposedValue`, `resultingState`, `destructive`, `attachmentOrdinal`,
`permissionVerdict`, `permissionReason`, `baseFingerprint`, `outcome`.

### `ChangeItemOutcome` — extended

| Field | Type | Change | Rules |
|---|---|---|---|
| `state` | `'applied' \| 'blocked' \| 'stale' \| 'failed' \| 'skipped'` | unchanged | The **write** phase's result. |
| `message` | `string?` | unchanged | User-facing; never a raw internal error. |
| `oldValue` / `newValue` | `unknown?` | unchanged | Truncated for display. |
| `publish` | `PublishOutcome?` | **new** | Present only when the approve-and-publish action ran. |

### `PublishOutcome` — new

| Field | Type | Rules |
|---|---|---|
| `state` | `'published' \| 'blocked' \| 'failed' \| 'not_applicable' \| 'skipped'` | `not_applicable` for a content type that does not use draft and publish — reported as **live on save**, with no publish attempted (FR-047). `skipped` only when the write phase did not reach `applied`, so a `stale`, `blocked` or `failed` item never causes a publish (FR-049). |
| `message` | `string?` | The permission reason for `blocked` (FR-046) or the host's reason for `failed` — e.g. a publish refused because required fields are empty. Never silently dropped. |

**Publish scoping invariant**: publish is **document-scoped, reported per item**. Two field changes
on one document produce one publish call; its outcome is attributed to each contributing item, so the
report reads per item as FR-050 requires without publishing twice.

### `ChangeSetStatus` — unchanged

`pending | applied | partially_applied | rejected | expired`. A mixed outcome — including a write
that applied while its publish was blocked — is `partially_applied`, reported as partially applied
rather than as a success (FR-052).

### `change-set` record additions

| Field | Type | Rules |
|---|---|---|
| `publishRequested` | `boolean` | Whether the approve-and-publish action was used. |
| `publishConfirmed` | `boolean` | The explicit confirmation (FR-045). A set with `publishRequested` true and `publishConfirmed` false is refused before anything is written — a single activation publishes nothing. |

---

## 8. Removed entities

Deleted from `server/src/types.ts` and their services (FR-016, research D11):

`AuditKind`, `AuditSeverity`, `AuditCategory`, `AuditLocation`, `AuditFinding`, `AuditCoverage`,
`AuditReport`, and the `AuditOptions` config shape.

`CHAT_MODES` / `ChatMode` are removed from the type surface. The two enumeration **columns** remain
(§6) — the types go because nothing reads them any more.

---

## 9. State transitions

Unchanged except for the publish phase, which is a **second phase of the same apply call** and cannot
be reached independently (research D14).

```text
change-set:  pending ──reject──────────────────────────────► rejected
                     ──expire (TTL)───────────────────────► expired
                     ──apply (all items applied,
                              publish outcomes all
                              published/not_applicable)───► applied
                     ──apply (anything blocked, stale,
                              failed, or a publish
                              blocked/failed)────────────► partially_applied

item (write):     none ──► applied | blocked | stale | failed | skipped
item (publish):   none ──► skipped        (write did not reach `applied`)
                        ──► not_applicable (target has no draft & publish)
                        ──► published | blocked | failed
```

Any transition out of `pending` still revokes the set's previews. A repeated approval is still a
no-op refused with `not_pending`, which is also why publish cannot be a separate later route.
