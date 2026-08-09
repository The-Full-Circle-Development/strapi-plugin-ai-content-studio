# Phase 1 Data Model: Model Catalog Refresh

**Date**: 2026-08-09 | **Plan**: [plan.md](./plan.md)

No persistent schema changes. The plugin store's `settings` shape is untouched — only the *default
value* of one field moves, and one derived view gains a fallback. This document records the entities,
their validation rules, and the one state transition that matters.

---

## Entity: `ModelOption`

The unit of the curated catalog. Unchanged shape; new instances.

| Field | Type | Rule |
|---|---|---|
| `id` | `string` | The identifier passed verbatim to the provider's API. **MUST** be verified against the provider's live catalog before it ships (FR-004). Never constructed, abbreviated, or date-suffixed. |
| `label` | `string` | Human-readable dropdown caption (FR-005). Presentational only — never sent to a provider. |

**Validation rules**
- `id` is unique within its provider's list.
- `id` must return `true`/`false` *correctly* from `modelSupportsVision(provider, id)` — verified per
  identifier in [research.md](./research.md) R-005, not assumed from the prefix.
- `id` must be reachable through the provider surface `registry.languageModel()` resolves to.
  Existence in a provider's catalog is necessary but not sufficient: `gpt-5.3-codex` is current yet
  documented Responses-API-only, which is one of the two reasons it was dropped from FR-002. No
  identifier in the shipped set depends on a non-default provider surface.

---

## Entity: `MODELS` (the curated catalog)

`Record<ProviderId, ModelOption[]>` in [admin/src/data/models.ts](../../admin/src/data/models.ts).
The guaranteed floor: always present, always sufficient on its own, no network dependency.

**Target contents** (FR-001–FR-003). Verification status from [research.md](./research.md):

### `anthropic` — 5 entries, all verified

| `id` | `label` |
|---|---|
| `claude-opus-5` | Claude Opus 5 |
| `claude-sonnet-5` | Claude Sonnet 5 |
| `claude-fable-5` | Claude Fable 5 |
| `claude-opus-4-8` | Claude Opus 4.8 |
| `claude-haiku-4-5` | Claude Haiku 4.5 |

Removed: `claude-sonnet-4-6` (still Active at the provider — dropped from the dropdown only, and
preserved wherever already saved; this is the exact case FR-008/FR-009 exist for).

### `openai` — 4 entries, all verified

| `id` | `label` | Status |
|---|---|---|
| `gpt-5.6-sol` | GPT-5.6 Sol | Verified |
| `gpt-5.6-terra` | GPT-5.6 Terra | Verified |
| `gpt-5.6-luna` | GPT-5.6 Luna | Verified |
| `gpt-5.4` | GPT-5.4 | Verified — general-purpose, no API deprecation |

Removed: `gpt-4.1`, `gpt-4o`, `o4-mini` — all absent from the current lineup, correctly dropped.
Also removed: `gpt-5.3-codex` — **dropped by maintainer decision 2026-08-09**. Current at the
provider, but an agentic-coding specialist in a content-authoring dropdown, and documented
Responses-API-only against a registry that resolves the default surface ([research.md](./research.md)
R-003). No reachability gate remains.

### `google` — 7 entries, all verified

| `id` | `label` | Status |
|---|---|---|
| `gemini-3.6-flash` | Gemini 3.6 Flash | Verified |
| `gemini-3.5-flash` | Gemini 3.5 Flash | Verified |
| `gemini-3.5-flash-lite` | Gemini 3.5 Flash Lite | Verified |
| `gemini-3.1-flash-lite` | Gemini 3.1 Flash Lite | Verified — **retained per Q2** |
| `gemini-2.5-pro` | Gemini 2.5 Pro | Verified |
| `gemini-2.5-flash` | Gemini 2.5 Flash | Verified |
| `gemini-2.5-flash-lite` | Gemini 2.5 Flash Lite | Verified — **retained per Q2** |

Removed: `gemini-3-flash-preview` (gone from the docs — correct). This is the only Google removal.

**Q2 resolved 2026-08-09 — keep the Flash Lite tier.** `gemini-3.1-flash-lite` and
`gemini-2.5-flash-lite` are both still current at the provider, so dropping them would have been a
curation loss rather than a correctness fix. Both stay.

**`gemini-3.1-pro-preview` does not ship** (T003 unresolved). It appears as a preview endpoint but not
in the current "All Gemini 3 models" table, and the confirming live send has not been run. The
default-to-omit rule applies: an unverified identifier is exactly what this feature exists to keep out
of the dropdown. Restoring it is one line, once a live send succeeds.

---

## Entity: `StudioSettings.activeModel`

Persisted per installation in the plugin store. **Shape unchanged; default value changes.**

| Aspect | Before | After |
|---|---|---|
| Type | `string` | `string` (unchanged) |
| Default (fresh install) | `claude-sonnet-4-6` | `claude-sonnet-5` (FR-006) |
| Default provider | `anthropic` | `anthropic` (unchanged) |
| Existing value on upgrade | preserved by `normalize()` | **preserved by `normalize()` — unchanged** (FR-008) |

**Invariant**: `activeModel` is *not* constrained to `MODELS[activeProvider]`. It may legitimately
hold any identifier the provider accepts. Treating the curated list as a validation allow-list would
break FR-008 and every existing install on a dropped identifier.

[config.ts:89-110](../../server/src/services/config.ts#L89-L110) already implements this correctly —
`normalize()` does `raw.activeModel ?? base.activeModel`, so a stored value always wins over the
default. **No migration is added.**

---

## State transitions

Only one, and it is the crux of US2.

```text
                       ┌─────────────────────────────────────────────┐
   fresh install ─────▶│ activeModel = claude-sonnet-5  (curated)     │
                       └─────────────────────────────────────────────┘

                       ┌─────────────────────────────────────────────┐
   upgraded install ──▶│ activeModel = <whatever was saved>           │
   (e.g. sonnet-4-6)   │  • still sent to the provider verbatim       │
                       │  • may NOT appear in MODELS[activeProvider]  │
                       └──────────────────┬──────────────────────────┘
                                          │ admin opens Settings
                                          ▼
                       ┌─────────────────────────────────────────────┐
                       │ Select renders: curated list                 │
                       │   + synthetic entry for activeModel          │
                       │     (only when not already curated)          │
                       └──────────────────┬──────────────────────────┘
                                          │ admin picks another model + saves
                                          ▼
                       ┌─────────────────────────────────────────────┐
                       │ activeModel = <curated id>                   │
                       │ synthetic entry disappears — never returns   │
                       └─────────────────────────────────────────────┘
```

**Rules for the synthetic entry**
1. Present **only** when `activeModel` is absent from `MODELS[activeProvider]`.
2. Rendered with the raw identifier as its label — the plugin has no display name for a model it
   doesn't curate, and inventing one would be a fabricated label.
3. Purely presentational. It is **not** added to `MODELS`, not persisted, and not offered after the
   admin moves off it.
4. Recomputed from `activeProvider` + `activeModel` on every render. Switching provider drops it,
   which is consistent with the existing reset at
   [Settings.tsx:172-173](../../admin/src/pages/Settings.tsx#L172-L173) (FR-010).

---

## Entity: session-start context (new, ephemeral)

Not persisted. Produced per session by the hook, consumed by the harness, discarded.

| Field | Source | Rule |
|---|---|---|
| standing rule | literal in the hook script | Always emitted, **including when the parse fails** (FR-014) |
| current catalog | parsed from `models.ts` at read time | Never a second copy (FR-013) |

Contract detail in [contracts/session-context.md](./contracts/session-context.md).

---

## What is explicitly *not* modelled

- No allow-list validation of `activeModel` against `MODELS` — see the invariant above.
- No `deprecated` / `retiredAt` field on `ModelOption`. The curated list is a recommendation set; an
  entry is either present or absent. Adding lifecycle metadata would be a second source of truth to
  keep current.
- No capability metadata (context window, vision, pricing) on `ModelOption`. `modelSupportsVision`
  stays prefix-based and stays correct (research.md R-005). Replacing it with provider-reported
  capability is listed Out of Scope in the spec.
