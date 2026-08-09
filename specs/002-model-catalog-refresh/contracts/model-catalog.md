# Contract: The Curated Model Catalog

**Module**: `admin/src/data/models.ts` | **Stability**: internal to the plugin, but load-bearing

This is the plugin's single source of truth for which models an administrator may select. It has three
consumers and one hard rule.

---

## Exported surface (unchanged by this feature)

```ts
export type ProviderId = 'anthropic' | 'google' | 'openai';
export const PROVIDERS: ProviderId[];
export const PROVIDER_LABELS: Record<ProviderId, string>;
export interface ModelOption { id: string; label: string }
export const MODELS: Record<ProviderId, ModelOption[]>;
```

No signature changes. Only the contents of `MODELS` change, plus the doc comment above it (which
currently asserts the list is "intentionally NOT fetched from a /models endpoint" — accurate under
this scope, and to be revisited only if US5 is ever taken up).

---

## Consumers

| Consumer | Uses | Contract it depends on |
|---|---|---|
| [Settings.tsx:190](../../../admin/src/pages/Settings.tsx#L190) | `MODELS[activeProvider]` | Non-empty for every `ProviderId`. An empty array renders a dropdown with no options. |
| [Settings.tsx:172-173](../../../admin/src/pages/Settings.tsx#L172-L173) | `MODELS[next][0].id` | **`MODELS[p].length >= 1` for all `p`** — this indexes `[0]` unguarded. A provider with an empty list throws on provider switch. |
| `.claude/hooks/session-model-context.mjs` (new) | parses the file's text | The `MODELS` object literal stays greppable — see "Parseability" below. |

The server does **not** import this module. `server/src/services/config.ts` holds the default model as
its own literal, and `registry.ts` passes `activeModel` through without consulting any list. That
decoupling is deliberate (the admin bundle and the server bundle are built separately) and is why
FR-006 is a *separate* edit rather than a derived value.

---

## Invariants

1. **`MODELS[p].length >= 1` for every `p` in `PROVIDERS`.** Enforced by the unguarded `[0]` index on
   provider switch. Never ship an empty provider list.
2. **`id` is verbatim provider input.** Not normalized, lowercased, suffixed, or aliased anywhere
   between this file and the provider SDK.
3. **`id` values are unique within a provider.** Duplicates produce duplicate React keys at
   [Settings.tsx:191](../../../admin/src/pages/Settings.tsx#L191).
4. **Every `id` is verified against the provider's live catalog before it ships** (FR-004). This is the
   rule the whole feature exists to institutionalize.
5. **Every `id` yields the correct answer from `modelSupportsVision`** — verified per identifier, not
   assumed. See [research.md](../research.md) R-005.
6. **Every `id` is reachable through the surface `registry.languageModel()` resolves to.** Existence in
   a provider's catalog is necessary but not sufficient — `gpt-5.3-codex` exists and is current yet may
   be unreachable, because it is documented as Responses-API-only. That is one of the two reasons it
   was dropped rather than shipped; treat it as the worked example of this invariant, not as a curated
   entry.
7. **`MODELS` is not an allow-list for `activeModel`.** A saved model outside this map is valid and must
   keep working (FR-008).

---

## Parseability (new requirement, from FR-013)

The session-start hook reads this file as text so that no second copy of the catalog exists. That makes
the file's *formatting* a soft contract:

- The `MODELS` object literal stays a plain literal with `{ id: '…', label: '…' }` entries.
- Identifiers stay single-quoted string literals on one line with their label.
- Provider keys stay bare identifiers (`anthropic:`, `openai:`, `google:`).

Do not refactor `MODELS` into a computed value, a spread of imported fragments, or a generated
structure without updating the hook script in the same change. The hook must degrade to emitting the
standing rule alone rather than failing (FR-014), so a break here is silent — it costs the reminder's
accuracy without breaking a build.

---

## Change protocol

Any edit to `MODELS` requires, in the same commit:

1. Each added/changed `id` verified against the provider's own current documentation or `/models`
   response — in this session, not from memory.
2. `modelSupportsVision(provider, id)` checked for that identifier.
3. One live send per provider whose list changed, in a running admin panel (Principle V).
4. README's "Updating the curated model list" section reconciled (FR-026, Principle IV).
5. `pnpm run build` and `dist/` staged alongside the source (FR-027, Principle IV).
