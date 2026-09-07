# Contract: Provider Layer

**Feature**: `specs/003-langchain-content-assistant` | Covers FR-001..FR-011, FR-053

The provider layer is LangChain. This document is the contract between the plugin's configuration
surface and that layer: what a provider is, how one is added, and what may never branch on provider
identity.

**No model identifier appears in this document.** Curated lists have exactly one home,
`admin/src/data/models.ts`.

---

## 1. The table is the whole provider surface

`server/src/services/providers.ts` exports one array of `ProviderDescriptor` (shape in
[data-model.md](../data-model.md) §1). Nothing else in the repository knows a provider's name.

```text
Adding a provider is exactly two edits, in one file:
  1. a static import of its @langchain/* chat model
  2. one row in the table
```

**Forbidden, absolutely:**

- A `switch` or `if` on provider identity anywhere in a chat, prompt, tool, approval or interface
  path (FR-001). The current `switch (activeProvider)` in `registry.ts:90-102` is deleted, not moved.
- `initChatModel`, or any dynamic `import()` whose specifier is a variable. esbuild cannot bundle it,
  so the package would be absent from the committed `dist/` and the provider would fail at runtime in
  a consumer's app (research D2).
- Fetching a model catalog from any provider endpoint (FR-003, Principle III).
- Letting an administrator name a provider, class or package to load (FR-002).

### The shipped set

| id | Chat model | Package | Curated list | Base URL |
|---|---|---|---|---|
| `anthropic` | `ChatAnthropic` | `@langchain/anthropic` | yes | no |
| `openai` | `ChatOpenAI` | `@langchain/openai` | yes | no |
| `google` | `ChatGoogleGenerativeAI` | `@langchain/google-genai` | yes | no |
| `openai-compatible` | `ChatOpenAI` | `@langchain/openai` | **no** | **required** |

The first three keep their existing ids, so no install's saved selection is orphaned. `README.md`
carries this table — which providers ship, and that a provider the layer supports but the
distribution does not carry is **absent from the selection rather than offered and broken**
(FR-011, FR-053).

### Verified constructor options

Read from the packages this session. A wrong option name means the key is silently ignored, so these
are contract, not preference:

| Provider | Key option | Model option | Endpoint option |
|---|---|---|---|
| `ChatAnthropic` | `apiKey` | `model` | — |
| `ChatOpenAI` | `apiKey` | `model` | `configuration.baseURL` |
| `ChatGoogleGenerativeAI` | `apiKey` | `model` | `baseUrl` |

### The `openai-compatible` invariant

`ChatOpenAI.useResponsesApi` **must stay `false`** — its verified default. A third-party or
self-hosted compatible endpoint implements `/chat/completions`, not `/responses`, so anything that
forces the Responses surface breaks the entire long tail. No feature that requires it may be
requested on this provider.

This is the same failure mode `CLAUDE.md` warns about for model identifiers: existing in a catalog
is necessary but not sufficient — it must be reachable through the surface the plugin actually uses.

---

## 2. Resolution is per request, from persisted configuration

`registry.getActiveModel()` runs on **every** request and rebuilds the chat model, so a rotated
credential or a changed model takes effect on the next message with no restart and no redeploy
(FR-007, SC-001).

```text
config.get()                     -> activeProvider, activeModel, providers, grounding
descriptor = table[activeProvider] ?? throw UNKNOWN_PROVIDER
descriptor.enabled === false       -> throw PROVIDER_DISABLED
config.getDecryptedKey(id)         -> null -> throw MISSING_KEY      (only this provider's key)
descriptor.requiresBaseUrl && !baseUrl -> throw MISSING_BASE_URL
=> { model, provider, modelId, supportsVision: descriptor.supportsVision(activeModel) }
```

`ProviderConfigError` keeps its role and gains one code:

| Code | Meaning | Surfaced as |
|---|---|---|
| `NO_ACTIVE_PROVIDER` | nothing configured | `400`, plain message |
| `PROVIDER_DISABLED` | provider off in settings | `400`, names the provider |
| `MISSING_KEY` | no credential saved | `400`, names the provider |
| `MISSING_BASE_URL` | **new** — `requiresBaseUrl` provider with no valid URL | `400`, names the provider and the field |
| `UNKNOWN_PROVIDER` | saved id not in the table | `400`, names the provider |

**All five are raised before generation begins** (FR-010), so the editor gets a
configuration-shaped message rather than a truncated stream. **No message, log line, transcript or
interface state may contain credential material** (FR-008, Principle I) — messages name the
provider, never the key.

---

## 3. Image input is declared, and defaults to deny

`supportsVision(model)` is declared **per descriptor** (FR-006), replacing the single prefix-matching
`modelSupportsVision()`. Default-deny: a provider whose rule cannot answer confidently returns
`false`.

### The four declared rules

Ported **verbatim** from the current `modelSupportsVision()` in `server/src/services/registry.ts` —
one rule per descriptor instead of one function branching on provider identity.

| Descriptor | `supportsVision(model)` is `true` when the lowercased identifier… |
|---|---|
| `anthropic` | starts with `claude-` |
| `google` | starts with `gemini-` |
| `openai` | starts with `gpt-4` or `gpt-5`, or matches `/^o\d/` — **and** does not start with `gpt-3.5`, and does not match `/embedding\|tts\|whisper\|moderation\|audio\|realtime/` |
| `openai-compatible` | never — the plugin cannot know what an arbitrary endpoint accepts |

**Porting rather than re-deriving is the contract, not a convenience.** Image input works on all
three first-party providers today, and FR-009's "identical behaviour to before this change" includes
that. A descriptor left at bare default-deny passes every negative test — the images are simply
withheld, correctly and quietly, from models that could have read them. That is why the verification
pass has a **positive** image scenario (quickstart A13) alongside the withholding one (A10).

These are **prefixes and shapes, not model identifiers**, and they are read from the file above
rather than recalled. Introducing a model identifier anywhere is still governed by the standing rule
in `CLAUDE.md`: verified against the provider's live catalog in the session that ships it, and living
only in `admin/src/data/models.ts`. A new identifier must be checked against its provider's rule
before it ships — a false `true` sends image bytes to a model that rejects them and fails the whole
request.

- When it returns `false`, image bytes are dropped from the outgoing message **before**
  `toBaseMessages` converts anything. They never reach the provider.
- Attachment placement by filename still works: the ordinal manifest reaches the model as text on
  every provider, and the assistant is instructed to say plainly that it cannot read file contents
  (FR-006, FR-023).
- `openai-compatible` returns `false` for every identifier. The plugin cannot know what an arbitrary
  endpoint accepts, and a wrong `true` sends image bytes to a model that rejects them, failing the
  whole request. Placement by name still works, which is the graceful degradation Principle III
  requires.

---

## 4. Settings API

### `GET /ai-content-studio/settings`

Policies: `admin::isAuthenticatedAdmin` + `plugin::ai-content-studio.is-super-admin` (unchanged).

```json
{
  "activeProvider": "anthropic",
  "activeModel": "<saved identifier, verbatim>",
  "grounding": { "enabled": true },
  "providers": {
    "anthropic":         { "isSet": true,  "enabled": true,  "masked": "sk-ant-...••••4f2a", "baseUrl": null },
    "openai":            { "isSet": false, "enabled": false, "masked": null,                 "baseUrl": null },
    "google":            { "isSet": false, "enabled": false, "masked": null,                 "baseUrl": null },
    "openai-compatible": { "isSet": true,  "enabled": true,  "masked": "sk-...••••9c1d",     "baseUrl": "https://api.example.com/v1" }
  }
}
```

`masked` is a mask only — plaintext never leaves the server. `baseUrl` is returned **in full**: it is
configuration, not a secret, and keeping it a distinct field is precisely what stops it being
conflated with the credential (FR-008).

### `PUT /ai-content-studio/settings`

Body (all fields optional; zod-validated):

```json
{
  "activeProvider": "openai-compatible",
  "activeModel": "<identifier, stored verbatim>",
  "grounding": { "enabled": false },
  "providers": {
    "openai-compatible": { "enabled": true, "apiKey": "…", "baseUrl": "https://api.example.com/v1" }
  }
}
```

| Rule | Behaviour |
|---|---|
| `activeProvider` not in the table | `400` `unknown_provider`, naming it (FR-002) |
| `activeModel` | stored **verbatim**. Never validated against a curated list, never normalized, lowercased or date-suffixed (FR-004, FR-005) |
| `apiKey` | write-only. Encrypted on receipt; absent means "keep the stored key"; an explicit `null` clears it. Never echoed back |
| `baseUrl` | absolute `http:`/`https:` URL, no userinfo component, trailing slashes trimmed. Invalid → `400` naming the field. `null` clears it |
| `baseUrl` on a `requiresBaseUrl: false` provider | accepted and stored, so a self-hosted deployment of a first-party provider is possible without new code |
| unknown provider key in `providers` | `400` — writes are validated even though reads preserve unknown keys |
| response | the same masked shape as `GET`, so the client rehydrates from the server rather than from its own optimistic state |

### `GET /ai-content-studio/settings/grounding` — new

Policies: `admin::isAuthenticatedAdmin` + `admin::hasPermissions` with
`plugin::ai-content-studio.settings.read`.

Returns the **exact** description text that requests are currently carrying, for the calling account
(FR-035). Contract in [install-description.md](install-description.md) §5.

---

## 5. Settings UI

`admin/src/pages/Settings.tsx`, built from `@strapi/design-system` v2 only — no new UI dependency.

| Element | Behaviour |
|---|---|
| Active provider | Options come from `admin/src/data/providers.ts` (a **separate** module from `models.ts` — research D15) |
| Active model | A curated `SingleSelect` when `MODELS[providerId]` exists; a plain text input when it does not (FR-004). The unguarded `MODELS[next][0].id` index is removed — it throws for a provider with no curated list |
| A saved non-curated identifier | Still rendered and still saved verbatim. The existing synthetic-option behaviour is kept for curated providers and is unnecessary for free-text ones (FR-005) |
| Base URL | Its **own labelled input**, visibly separate from the credential field, marked required for `requiresBaseUrl` providers. Never a placeholder or hint on the key field (FR-008) |
| API key | Unchanged: `type="password"`, write-only, placeholder shows the mask |
| Grounding | A `Toggle`, defaulting to on, with a hint stating what it embeds and that it authorizes nothing |
| Grounding inspector | A read-only panel showing the exact text, its tier, and its character count against the budget (FR-035) |
| Provider with no curated list | Says so in English, next to the model input — not silently different (Principle III's "degrade gracefully and say so") |

A directly entered identifier must survive a save/reload round trip **unchanged** — this is an
explicit edge case, and it is the same code path that keeps an install working after an identifier is
dropped from a curated list in a later release.
