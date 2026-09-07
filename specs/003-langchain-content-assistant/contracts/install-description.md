# Contract: Install Description

**Feature**: `specs/003-langchain-content-assistant` | Covers FR-027..FR-037, SC-005, SC-006, SC-011

The generated structural description of the running install, embedded as section 10 of the
instructions. Produced by `server/src/services/grounding.ts`.

This is the "analyse the project" capability, made safe for a plugin that ships to many different
projects. A hard-coded field map is wrong everywhere except the one project it was written for — the
previous version of this plugin shipped exactly that mistake.

---

## 1. Inputs — and nothing else

| Allowed input | Source |
|---|---|
| Content-type schemas | `strapi.contentTypes`, keys prefixed `api::` only |
| Component schemas | `strapi.components` |
| Preview targets | the plugin's own `getPreviewOptions().paths` keys |
| The caller's read access | `content-manager` `permission-checker`, live, per request |

**Forbidden inputs**, each for a stated reason:

| Forbidden | Why |
|---|---|
| The host application's source code, controllers, services, lifecycle hooks | Not reproducible across the different projects this plugin ships to; cost scales with the host repository rather than the schema; it would make the instructions depend on files the plugin has no contract with (FR-028) |
| The Document Service — any entry, any count | Would put content in the prompt and make the text vary with content volume (FR-029, FR-030) |
| Media URLs, user data, anything secret-like | FR-029 |
| A language model | Non-deterministic by construction, and it would spend a provider call to produce the input to a provider call (FR-030) |
| Wall-clock time | FR-030 |

---

## 2. Section order and content

Fixed order. Every list sorted lexicographically. Enum values keep their **declared** schema order,
because that order is itself information and is stable.

```text
### This install's structure
<preamble: facts, not permission; rules above win; partial marker if applicable>

#### Content types
<per content type, sorted by uid>
- <uid> — "<displayName>" (<single|collection>)
  draft & publish: <yes|no>   localized: <yes|no>
  preview target: <configured|none>
  fields:
    - <name>: <type>[, required][, enum: a | b | c]
              [, relation -> <target> (<oneToOne|oneToMany|manyToOne|manyToMany>)]
              [, component: <component uid>[, repeatable]]
    - …
  media fields: <dotted paths, sorted>

#### Components
<per component uid, sorted>
- <uid>
  fields: <same field rendering>

#### Preview targets
<content-type uids with a configured preview path, sorted>
```

Covers every item FR-027 enumerates: identifier, kind, display name, draft-and-publish flag,
localization, field name, type, required flag, enumeration values, relation target and cardinality,
component reference and repeatability, component structures, media fields, preview targets.

`media fields` is listed explicitly rather than left to be inferred from the field list — locating
media is the single most common structural question (US4-1), and naming the dotted paths is what lets
the assistant answer without a tool round trip (SC-006).

---

## 3. Determinism

| Source of variance | Rule |
|---|---|
| Key iteration order | every list sorted lexicographically before rendering |
| Section order | fixed, as above |
| Time | no timestamps anywhere |
| Content volume | nothing read from the Document Service; no counts of entries |
| A model | none involved — this is string assembly |
| Locale | no locale-dependent formatting, casing or collation; sorts use a fixed byte ordering, not `localeCompare` |

**Verification** (SC-004, US4-2): the same install, the same account and an unchanged schema must
produce an identical description on two consecutive requests, and identical across ten.

---

## 4. Permission scope

A content type appears **only** if
`permission-checker.create({ userAbility, model: uid }).can.read()` allows it — the same live check
every tool makes (FR-031).

- Two accounts in the same install legitimately receive **different** descriptions. Each is stable
  for that account and that schema — determinism is per account, not merely per install.
- A component appears only if it is referenced by a content type the caller can read.
- **The description authorizes nothing** (FR-037). An account that can read a content type but not
  update it will see it described *and* still get a blocked plan item with a reason. The description
  is a map, not a key.

---

## 5. Reuse and recomputation

Cache key: `(schemaFingerprint, readableFingerprint)`.

| Fingerprint | Computed from |
|---|---|
| `schemaFingerprint` | sha256 over the canonically serialized `api::*` content-type schemas plus components |
| `readableFingerprint` | sha256 over the caller's **sorted** readable-uid list |

- A new content type changes `schemaFingerprint`, so the next request reflects it — **with no
  restart** (FR-033, US4-3).
- The readable-uid list is the only ability input that can change the output, so the pair is an exact
  key: a cache hit is provably the right text, not a probably-still-current one.
- **No TTL.** A TTL would make the description a function of *when* you asked, which is precisely the
  non-determinism FR-030 exists to prevent.
- The schema changes between two turns of the same conversation: the newer description applies from
  the next request, and the assistant must not treat the earlier one as still true. Nothing in stored
  history is rewritten.

---

## 6. Size budget and degradation

**Declared budget**: 24,000 characters (`grounding.maxChars`, clamped `2,000..80,000`). Chosen so the
description cannot crowd out a long conversation on a large install (SC-011) while comfortably fitting
an ordinary project in full.

Degradation is by **tier**, applied by the same rule every time (FR-032):

| Tier | Applied when | Content |
|---|---|---|
| `full` | within budget | everything in §2 |
| `no-components` | `full` exceeds budget | content types keep all fields; the `#### Components` section is dropped and component references are named but not expanded |
| `names-only` | `no-components` exceeds budget | per content type: uid, display name, kind, draft-and-publish, localization, preview target, and the media-field paths. No other field detail |

If `names-only` still exceeds the budget, content types are dropped from the **end of the sorted
order** and the count dropped is stated. Dropping deterministically from a fixed order is arbitrary
but reproducible, which is what the requirement asks for; dropping "the least important" would
require a judgement that varies.

Any tier below `full` sets `partial: true`, and the preamble states that the description is partial
and that the assistant must discover the remainder with tools. `charCount` must never exceed the
budget (SC-011).

---

## 7. The off switch — two switches, one precedence rule

There are **two** `enabled` flags, and they are not interchangeable:

| Switch | Where | Who sets it | Role |
|---|---|---|---|
| `grounding.enabled` | plugin config — `config/plugins.ts` in the host app, defaulted in `server/src/config/index.ts` | the host application's developer, at deploy time | The **hard off-switch**. An install that must never carry a generated prompt section sets it `false`, and no runtime toggle can re-enable it |
| `settings.grounding.enabled` | the plugin store, written by the settings `Toggle` | a super-admin, at runtime | The **runtime toggle** — turning grounding off without a redeploy |

**Precedence**: the description is embedded only when **both** are `true`.

```text
effectiveGrounding = pluginConfig.grounding.enabled && settings.grounding.enabled
```

The rule is computed in exactly one place — `config.isGroundingEnabled()` — and every caller
(the prompt composer, the chat controller, the inspector) reads that. Two flags with the rule
re-derived at each call site is how they end up disagreeing.

Both default to **`true`** (FR-036).

Justified: the description is deterministic, size-bounded, permission-filtered and inspectable — the
four properties that make an on-by-default generated prompt section safe for an existing install.

When the hard off-switch is `false`, the settings `Toggle` renders **disabled**, with an English hint
naming the plugin-config key that is holding it off — an administrator is never left flipping a
control that does nothing.

With grounding off, by either switch:

- section 10 is absent;
- the assistant falls back to tool-based discovery;
- **nothing else about its behaviour changes** — no other section is altered, no tool is added or
  removed, and stored history stays valid. Switching it off mid-conversation simply means the next
  turn discovers with tools.

---

## 8. Inspector

`GET /ai-content-studio/settings/grounding`, gated on `plugin::ai-content-studio.settings.read`.

```json
{
  "enabled": true,
  "disabledBy": null,
  "text": "### This install's structure\n…",
  "tier": "full",
  "partial": false,
  "charCount": 8412,
  "maxChars": 24000,
  "contentTypeCount": 14,
  "omittedContentTypeCount": 0
}
```

- `text` is the **exact** text requests are carrying for the calling account — not a re-render, not a
  sample (FR-035). If the inspector and the request could disagree, the inspector is worthless.
- Scoped to the **calling** account, so a settings reader sees their own description. It is not a way
  to read a schema they cannot otherwise read.
- `enabled` is the **effective** value from §7 — the AND of both switches, never one of them.
- With grounding off: `enabled: false`, `text: null`, and `disabledBy` is `"config"` or `"settings"`
  naming which switch is holding it off, so the panel states plainly that requests are carrying no
  description — and where to go to change that — rather than showing a stale one.

**Verification** (SC-009): the inspector is one of the surfaces swept for credential material. It is
schema-only by construction (§1), and the sweep confirms it.
