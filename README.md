# strapi-plugin-ai-content-studio

A multi-provider AI assistant embedded in the **Strapi v5** admin panel. Editors manage content
(find / read / create / edit / publish) through natural-language chat with tool calling, and a
super-admin settings page switches the AI provider + model and manages API keys **without
redeploying**.

- **Providers:** Anthropic, OpenAI, Google, plus a generic **OpenAI-compatible endpoint** — all
  switchable from the UI. Language-model access goes through one LangChain-backed provider layer
  built from a declarative table (see *Providers* below).
- **Streaming chat** with multi-step tool calling over Strapi's Document Service.
- **Nothing is written without approval.** The assistant has no write tools. It *proposes* a change
  plan; the only code path that mutates content is an admin route driven by your click.
- **Live preview** of a pending plan on your real front-end, before anything is saved.
- **Persistent per-user conversations** that survive reloads and restarts.
- **Deferred media ingestion:** attached files stay in your browser and enter the Media Library only
  when you approve the plan that uses them.
- **Per-caller RBAC:** every content tool is gated by the calling admin's content-manager
  permissions — the assistant can never do more than the user could in the Content Manager.
- **Encrypted keys at rest** (AES-256-GCM); the settings API returns a mask only, never the key.
- **The prompt knows your schema.** A deterministic, permission-filtered, size-bounded description
  of *this* install's content types, fields, components and preview targets is embedded in the
  assistant's instructions, and is inspectable from the settings page. On by default; it authorizes
  nothing.
- **Copyable replies:** copy an assistant message as Markdown, or a single code block on its own.
- **Approve & Publish** in one deliberate, clearly risky action, behind an explicit confirmation.
- **Self-contained:** every AI dependency is bundled into the shipped `dist/`. Consumers don't
  install any AI dependencies and don't run a build step.

---

## Install (git dependency)

This package is consumed as a **git dependency** — the built `dist/` is committed, so installs are
instant and require no build on the consumer side.

1. Add it to your Strapi project's `package.json` dependencies:

   ```jsonc
   // pin to the default branch = always the latest push ("latest")
   "strapi-plugin-ai-content-studio": "github:The-Full-Circle-Development/strapi-plugin-ai-content-studio"

   // …or pin to a release tag for reproducible deploys (recommended for prod)
   "strapi-plugin-ai-content-studio": "github:The-Full-Circle-Development/strapi-plugin-ai-content-studio#v1.0.0"
   ```

   or `pnpm add github:The-Full-Circle-Development/strapi-plugin-ai-content-studio`.

2. Enable it in `config/plugins.ts` (the key is the plugin's `strapi.name`, **not** the package name):

   ```ts
   export default ({ env }) => ({
     'ai-content-studio': { enabled: true },
   });
   ```

3. Set the required env var (see below). Restart / redeploy. No build step, no `resolve` path.

Routes mount under `/ai-content-studio/*`. The chat lives in the main nav ("AI Studio"); the
configuration lives in **Settings → AI Content Studio**.

### Required env var

| Var | Purpose |
|-----|---------|
| `AI_STUDIO_ENC_KEY` | **Required.** 32-byte key (base64) that encrypts provider API keys at rest. Distinct from `APP_KEYS` and `ENCRYPTION_KEY`. |
| `AI_STUDIO_SHOW_ERROR_DETAILS` | Optional, default `false`. Set `true` to surface the **real provider error message** (redacted of anything key-like) in the chat UI instead of a generic message — useful for debugging "The AI provider returned an error". Keep `false` in production. Equivalent to `config: { showProviderErrorDetails: true }` in `config/plugins.ts`. |
| `AI_STUDIO_PREVIEW_BASE_URL` | Optional. Front-end origin used to build preview URLs, e.g. `https://staging.example.com`. Only read when `preview.enabled` is true — see [Live preview](#live-preview-opt-in). |

Upgrading from an earlier version requires **no new configuration**: every option added by the
preview / persistence / audit work defaults to the previous behaviour, and preview is opt-in and off.

```bash
openssl rand -base64 32
# or: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Add it to each consuming project's `.env` (local) and to its hosting env (e.g. Strapi Cloud). A
missing/wrong-length key aborts boot with a clear message; the key value is never logged.
**Rotating the key invalidates all stored provider keys** — re-enter them afterwards.

### First key (super-admin)

Log in as a super-admin → **Settings → AI Content Studio → Configuration** → pick provider + model,
toggle the provider on, paste the API key, **Save**. Reload: the field is empty and shows only a
mask (e.g. `sk-ant-...••••4f2a`). Then open **AI Studio** in the nav and chat.

### RBAC

- **Chat**: grant `Plugins → AI Content Studio → Use AI Content Studio chat` to your editor roles.
- **Settings** (provider/model + keys): **super-admin only**, enforced by route policy + the
  settings link permission. Keep the settings actions assigned to super-admin only.
- **Grounding inspector** (`GET /ai-content-studio/settings/grounding`): gated on
  `Read AI Content Studio settings` (`settings.read`) rather than super-admin, because it returns
  only what the **calling** account can already read. It is the one non-super-admin settings
  surface.
- `audit.run` is **no longer registered** — the QA scan and security audit capabilities are retired.
  See *Breaking changes* below.

Content operations are always bounded by the caller's own content-manager permissions, checked
twice for a write: once when the plan is proposed, and again against the caller's live ability at
the moment of apply.

---

## Providers

Language-model access goes through **one provider layer** built from a declarative table in
[`server/src/services/providers.ts`](server/src/services/providers.ts). That table is the whole
provider surface — nothing else in the codebase knows a provider's name, and adding one is a static
import plus one row.

| Provider (id) | Curated model list | Base URL |
|---|---|---|
| Anthropic (`anthropic`) | yes | no |
| OpenAI (`openai`) | yes | optional |
| Google (`google`) | yes | optional |
| OpenAI-compatible endpoint (`openai-compatible`) | **no** | **required** |

**A provider the adapter layer supports but this distribution does not carry is absent from the
selection rather than offered and broken.** Every provider must bundle into the committed `dist/`,
so the shipped set is deliberately small — breadth comes from the compatible endpoint instead.

### Configuring one

**Settings → AI Content Studio → Configuration.** Per provider: a toggle, a write-only **API key**
field, and a **Base URL** field. Then pick the active provider and model at the top.

- **Base URL is its own labelled field**, never merged into or shown beside the credential. It is
  configuration, not a secret, so it is returned in full by the settings API and can be checked and
  corrected without touching the key. It accepts an absolute `http:`/`https:` URL with no username
  or password; trailing slashes are trimmed. `http://` is accepted so a self-hosted server on your
  network works.
- **Required for `openai-compatible`.** Without one, requests are refused *before generation begins*
  with a message naming the field — never a stream that dies half-way.
- **Optional for the other three**, so a self-hosted or proxied deployment of a first-party provider
  needs no new code.

### The OpenAI-compatible endpoint

One adapter, zero per-provider code, reaching Groq, Mistral, DeepSeek, Together, Fireworks,
Perplexity, Cerebras, xAI, OpenRouter, Ollama, vLLM, LM Studio and any self-hosted server speaking
the same wire format. Point the Base URL at the endpoint and enter the model identifier directly.

Two consequences worth knowing:

- It ships **no curated model list**, so the model field becomes a plain text input. Whatever you
  type is stored and sent **verbatim** — never normalized, lowercased or date-suffixed.
- It reports **no image-input support**, for any identifier. The plugin cannot know what an arbitrary
  endpoint accepts, and a wrong guess would send image bytes to a model that rejects them and fail
  the whole request. Attachment *placement by filename* still works, on every provider.

### Model identifiers

A directly entered identifier survives a save/reload round trip unchanged, and an install keeps
working after an identifier is dropped from a curated list in a later release. The curated lists are
hardcoded by design and are never fetched from a provider `/models` endpoint — see *Updating the
curated model list*.

---

## Project structure in the prompt (grounding)

The assistant is told what *this* install actually contains, so it stops guessing at field names.

**On by default.** A generated description of the running schema — content types with their kind,
display name, draft-and-publish and localization flags and preview target; every field with its
type, required flag, enumeration values, relation target and cardinality, component reference and
repeatability; component structures; and the dotted paths of every media field — is embedded as a
clearly delimited, explicitly subordinate section of the instructions.

Four properties are what make that safe to have on by default:

- **Deterministic.** Identical request inputs produce a byte-identical description. Every list is
  sorted by a fixed byte ordering, enum values keep their declared order, and there are no
  timestamps, no entry values, no counts of content and no language model anywhere in it.
- **Permission-filtered.** A content type appears only if the **calling** account can read it, via
  the same live check every tool makes. Two accounts legitimately see different descriptions.
- **Size-bounded.** A declared character budget (24,000 by default) with deterministic tiered
  degradation — full, then component expansions dropped, then names and flags only, then content
  types dropped from the end of the sorted order with the count stated. It says when it is partial
  and tells the assistant to discover the rest with tools.
- **Inspectable.** The settings page shows the **exact** text your requests are carrying, its tier
  and its size against the budget.

**It derives only from the running instance's schema and this plugin's own configuration. It never
reads, parses or analyses your application's source code.**

**It authorizes nothing.** Every read and every applied change is still checked against the caller's
live permissions, so a content type described here can still come back blocked with a reason. It is
a map, not a key.

### Two switches, one precedence rule

| Switch | Where | Who sets it | Role |
|---|---|---|---|
| `grounding.enabled` | `config/plugins.ts` in your app | your developer, at deploy time | The **hard off-switch**. No runtime toggle can re-enable it |
| The settings **Toggle** | the plugin store | a super-admin, at runtime | Turns it off without a redeploy |

The description is embedded **only when both are `true`**. Both default to `true`. With the hard
off-switch `false`, the settings Toggle renders disabled and names the config key, so nobody is left
flipping a control that does nothing.

```ts
// config/plugins.ts
'ai-content-studio': {
  enabled: true,
  config: {
    grounding: { enabled: true, maxChars: 24000 }, // maxChars is clamped to 2000..80000
  },
},
```

With grounding off, the assistant falls back to tool-based discovery and **nothing else about its
behaviour changes** — no other instruction changes, no tool is added or removed, and stored history
stays valid.

---

## How changes are made (nothing is written without approval)

The assistant has **no write tools**. `createEntry`, `updateEntry` and `publishEntry` were removed.
Instead:

1. You ask for a change. The assistant reads what it needs and calls `proposeChanges`, which records
   a **pending change plan** — a row in the plugin's own table. No content is touched.
2. The panel renders the plan: per item, the target content type, the document, the field, the
   current value, the proposed value, and whether the result will be a draft or published. Items you
   lack permission for are shown as blocked and cannot be approved.
3. You approve all, approve a subset, or reject. Items that remove content are marked destructive and
   need a separate, explicit confirmation.
4. Approving calls `POST /change-sets/:id/apply` — the **only** code path in this plugin that mutates
   content. It re-checks your permissions per item, re-checks a per-field fingerprint (so a colleague's
   edit is never silently overwritten — the item comes back `stale` instead), demands the destructive
   confirmation, and reports each item's outcome with its old and new value.

Because apply is a plain HTTP route and not a tool, there is no path from the model to the Document
Service at all. The guarantee is structural, not a prompt instruction.

Pending plans expire after `preview.ttlMinutes` (default 30) without being applied.

### Approve & Publish (Risky)

The plan card also offers **Approve & Publish (Risky)** — a visually distinct danger action that
applies the approved items and then publishes each affected document, in one deliberate step.

**Approve all, Approve selected, Reject and Select all are unchanged** in behaviour and appearance.

It runs as a **second phase of the same apply call**, after every write completes, so a document is
never published against a half-written draft. It cannot be reached independently.

Activating it only **arms a confirmation** — a single activation writes nothing and publishes
nothing, and dismissing it or navigating away leaves both undone. The confirmation states both
consequences, and the second one is why it exists:

> Publishing makes this content publicly visible immediately.
>
> It publishes each affected document's **entire current draft** — not only the fields this plan
> reviewed. Any unreviewed draft edit already sitting on those documents will go live with it.

Document-scoped publication is the one consequence of this action that is **invisible in the plan's
own before/after rows**, which is exactly why it is spelled out before you commit.

Per document, in the publish phase:

- **`publish` is re-checked against your live ability at the moment of application.** It is a
  *separate* action from the `update` already checked for the write, and is never inherited from it —
  you may hold one without the other. A refusal is reported as **blocked with its reason**, never
  skipped silently, and the field write's outcome is still reported accurately alongside it.
- A content type that does not use draft & publish is reported **live on save**; no publish is
  attempted.
- A write that came back `stale`, `blocked` or `failed` **never** causes a publish.
- Two field changes on one document are **one** publish call, reported on each contributing item.

The per-item report is appended to the conversation and persisted on the thread, so a reload replays
it. A set is reported `applied` only when every write applied **and** every publish either succeeded
or was not applicable — a blocked publish makes it `partially_applied`, never a success.

The destructive-item confirmation remains **separate and additionally required**.

---

## Copying the assistant's replies

Every assistant message carries a copy control that places its **Markdown source** on the clipboard,
and every fenced code block carries one that copies **only that block**. Both work identically on a
conversation restored after a reload.

- A message that is only a structured card (a plan, an apply report) gets **no control**, rather
  than one that copies nothing.
- A reply that is still streaming gets no control, so a partial value is never offered as complete.
- The outcome is announced to assistive technology, not just coloured.
- If the browser blocks the clipboard — most often because the panel is served over plain HTTP, where
  `navigator.clipboard` does not exist — a hidden-textarea fallback is tried, and if that fails too
  you get an **explicit message**. Never a silent no-op.

---

## Conversations are private to their owner

Each admin user gets their own thread list, persisted in hidden plugin content types so it survives
reloads, logouts, and server restarts. Threads are listed, opened, renamed, and deleted only by their
owner, and a request for another user's thread answers **404** (not 403) so thread ids are not
enumerable.

> **Super-admin is NOT exempt.** This is deliberately stricter than how the rest of Strapi treats
> super-admin. A super-admin cannot read another user's conversations through this plugin. If your
> compliance posture requires an administrator to be able to read all conversations, this plugin is
> not currently the right tool for that.

Long threads are handled by condensing older turns into a running summary rather than failing the
request; the panel says when that has happened. Deleting a thread removes its messages, pending
plans, previews, and staged files — but not content or Media Library entries that an approved plan
already created.

---

## Live preview (opt-in)

Preview renders a **pending** plan on your real front-end while the database still holds the old
content. It is **off by default** because it is the only feature that opens a non-admin HTTP surface.

```ts
// config/plugins.ts in the consuming project
export default ({ env }) => ({
  'ai-content-studio': {
    enabled: true,
    config: {
      preview: {
        enabled: true,
        baseUrl: env('AI_STUDIO_PREVIEW_BASE_URL'),   // e.g. https://staging.example.com
        ttlMinutes: 30,
        paths: {
          'api::page.page': '/:slug',
          'api::blog-post.blog-post': '/blog/:slug',
          'api::homepage.homepage': '/',
        },
      },
      attachments: { totalBudgetMb: 50 },
      audit: { timeBudgetSeconds: 120 },
    },
  },
});
```

Then register the overlay middleware in the content-API pipeline:

```ts
// config/middlewares.ts
export default [
  // …your existing middlewares…
  'plugin::ai-content-studio.preview-overlay',
];
```

### What your front-end must do

Exactly one thing: **forward the preview token to its Strapi content-API requests.**

```ts
// your existing Strapi fetch helper
const res = await fetch(`${STRAPI}/api/pages?filters[slug][$eq]=${slug}&populate=deep`, {
  headers: {
    ...(previewToken ? { 'x-ai-studio-preview': previewToken } : {}),
  },
  cache: 'no-store', // a previewed render must never be cached or served to anyone else
});
```

The panel opens `baseUrl` + the resolved path + `?aiStudioPreview=<token>`. Your site reads that
query parameter server-side — the same seam a Strapi draft-preview secret already uses — and passes
it on as the `x-ai-studio-preview` header (or as `?aiStudioPreview=` on the Strapi URL). The response
you receive already contains the proposed values: no SDK, no merge logic, no schema knowledge.

The token is HMAC-signed over `{ sessionId, ownerId, changeSetId, exp }` with a labelled subkey
derived from `AI_STUDIO_ENC_KEY` — **no new env var**. It lasts `ttlMinutes`, is valid only while its
plan is still pending, and is revoked on apply, reject, expiry, or thread deletion. Treat it like a
provider key: it is a bearer credential for those proposed values, and it must not be logged.

If preview is off, `baseUrl` is missing, or a content type has no `paths` entry, the preview request
answers `409 preview_not_configured` and the panel shows a field-by-field before/after comparison
instead. **Approval is never blocked by a missing preview target.**

---

## Attachments are held, not uploaded

Attaching a file no longer uploads it. Files stay in your browser with stable ordinals (`#1`, `#2`)
and reach the model as a text manifest, so "image #1 to the hero" resolves even on a model that
cannot see the image. A file enters the Media Library only when you approve a plan that uses it, or
when you explicitly ask to upload — checked against your Media Library create permission before any
byte is written, and idempotent so a retried approval never produces a duplicate.

---

## Accepted limitations in this version

Stated here so they are not rediscovered as bugs:

- **GraphQL is not overlaid.** The preview overlay applies to the REST content API only. Projects
  whose front-end uses GraphQL get the in-panel field comparison instead.
- **Staged preview media is single-instance.** Bytes for a not-yet-ingested image live in the memory
  of the instance that created the preview. On a multi-instance deployment a staged-file request may
  land elsewhere and return 404, in which case the preview shows the *current* image rather than the
  proposed one. A restart expires previews early. Field overlays are unaffected.
- **Held attachments do not survive a panel reload**, by design — the alternative is storing
  unapproved user files server-side, which is what deferred ingestion exists to avoid. A restored
  thread shows them as expired and invites you to re-attach.
- **The generated schema description derives from the running instance only** — content types,
  components, relations, media fields and this plugin's preview configuration. It never reads,
  parses or analyses your application's source files.
- **`openai-compatible` never claims image-input support**, for any identifier, because the plugin
  cannot know what an arbitrary endpoint accepts. Attachment placement by filename still works.
- **The automated test suite covers pure functions only.** It asserts the deterministic composition
  of the instructions, the deterministic derivation and tiered degradation of the schema
  description, the declared image-input rule and configuration normalization. It never calls a
  provider, opens a socket or boots a host — so streaming, tool calling, RBAC, replay and the UI
  are still verified **manually, in a running admin panel**, and a model identifier is still only
  verified by one live send.

---

## Breaking changes

Each entry names the version that removes it and what a consumer should do.

### 1.7.0

| Breaking change | What you should do |
|---|---|
| **`plugin::ai-content-studio.audit.run` is no longer registered.** | Nothing is required — a stored grant for an unregistered action is inert, and the upgrade will not fail. Remove it from any role for tidiness. |
| **The QA scan and the security audit capabilities are gone.** The `runQaScan` and `runSecurityAudit` tools, both audit services, the audit policy and the audit report card are deleted. | Nothing. The capability is **retired, not moved**, and no replacement is planned in the panel. If asked for one, the assistant now says so plainly rather than improvising a substitute. |
| **The Layout Mapping and Code Audit modes are gone**, along with the mode selector. Every conversation is content editing. | Nothing. Existing conversations — including ones recorded under a removed mode — open, replay in full and accept new messages. The `chat-thread.mode` and `chat-message.modeAtSend` columns are deliberately left in place as vestigial rather than migrated. A stored audit tool call renders as a plain "Used …" pill. |
| **The `audit` plugin config key is ignored.** | Remove `audit: { … }` from `config/plugins.ts`. An unknown key is harmless, but it no longer does anything. |
| **`@ai-sdk/anthropic`, `@ai-sdk/openai` and `@ai-sdk/google` are no longer dependencies.** | Nothing — they were bundled, never installed by you. `ai` and `@ai-sdk/react` remain: they are the wire and storage format, not providers. |

Not a removal, but worth knowing on upgrade: **grounding is on by default** (see *Project structure
in the prompt*). Set `grounding: { enabled: false }` in `config/plugins.ts` if this install must
never carry a generated prompt section.

---

## Keeping consumers up to date ("latest")

The dependency above pins to the **default branch (`main`)**, i.e. the latest push. How updates reach
a deployed project depends on the lockfile:

- `pnpm install` with a **frozen lockfile** (the default in CI / many deploy pipelines when `CI=1`)
  pins the resolved commit in `pnpm-lock.yaml` and will **not** pick up new commits on its own.
- To pull the latest before a deploy, run **`pnpm update strapi-plugin-ai-content-studio`** (refreshes
  the lockfile to the newest `main` commit), commit the lockfile, and redeploy — or run the deploy's
  install without `--frozen-lockfile`.

**Recommended for production:** pin consumers to a **release tag** (`#v1.2.0`) and bump the tag in
each project when you want the update. It's explicit and reproducible. Use the bare branch ref only
where you're comfortable rolling "latest".

---

## Updating the curated model list

Model lists are **curated/hardcoded** (by design — not fetched from any `/models` endpoint). They
live in [`admin/src/data/models.ts`](admin/src/data/models.ts), which is the single source of truth
for the list. As shipped:

```ts
export const MODELS: Record<ProviderId, ModelOption[]> = {
  anthropic: [
    { id: 'claude-opus-5', label: 'Claude Opus 5' },
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
    { id: 'claude-fable-5', label: 'Claude Fable 5' },
    { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  ],
  openai: [
    { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
    { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
    { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
    { id: 'gpt-5.4', label: 'GPT-5.4' },
  ],
  google: [
    { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
    { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
    { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite' },
    { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
  ],
};
```

`id` is the string passed straight to the provider's API; `label` is the dropdown caption. Edit the
map, then **release** (below). All consuming projects pick up the new list on their next update +
redeploy.

This snippet is the one sanctioned copy of the list, which is why it has to be reconciled in the
same commit as any edit to `models.ts` — see [`CLAUDE.md`](CLAUDE.md).

> **`claude-fable-5` requires 30-day data retention.** It is not available to organizations
> configured for zero data retention: every request from such an org returns `400
> invalid_request_error`, regardless of the payload. The plugin cannot detect an org's retention
> setting, and provider error details are redacted by default (see
> `showProviderErrorDetails`), so a correctly-configured ZDR customer who selects Claude Fable 5
> will see only a generic failure with no route to the real cause. If that is your situation, remove
> the entry from the `anthropic` array.

### Before you add an id

The active model is **not** validated against this map — an install may hold any identifier the
provider accepts, and dropping an entry here never breaks an install already saved on it. That
also means a wrong id fails silently at the only place it matters: the send. So verify every
identifier against the provider's live catalog before shipping it, never from memory, and check it
against its provider's declared `supportsVision` rule in
[`server/src/services/providers.ts`](server/src/services/providers.ts) so image attachments are
neither dropped for a capable model nor sent to one that would reject them. Those rules are declared
**per provider** in the table there (they replaced a single prefix-matching function that branched
on provider identity), and they are covered by
[`providers.test.ts`](server/src/services/providers.test.ts) — a descriptor reverted to bare
default-deny turns that suite red instead of silently withholding images.

This repository enforces that rule two ways: [`CLAUDE.md`](CLAUDE.md) states it durably, and a
`SessionStart` hook ([`.claude/hooks/session-model-context.mjs`](.claude/hooks/session-model-context.mjs),
registered in [`.claude/settings.json`](.claude/settings.json)) restates it at the start of every
Claude Code session with the current catalog parsed out of `models.ts` at read time. Both are repo
tooling only — `files: ["dist"]` keeps them out of the published package.

---

## Releasing (maintainer)

The built `dist/` is committed so consumers need no build. After any change:

```bash
corepack pnpm@10 install   # first time only
corepack pnpm@10 run build # rebuilds dist/admin and dist/server
git add -A
git commit -m "..."
# optional but recommended: tag a release
npm version patch          # or minor/major — bumps package.json + creates a git tag
git push --follow-tags
```

> If you forget to rebuild, consumers get stale `dist/`. Consider a CI check that runs
> `pnpm run build` and fails if `dist/` has uncommitted changes.

### pnpm note

Build the bundles with a pnpm that honors `pnpm.onlyBuiltDependencies` (so `esbuild`'s native
binary is built). pnpm 10 works out of the box (`corepack pnpm@10 …`).

---

## Local development

```bash
corepack pnpm@10 install
corepack pnpm@10 run build   # produce dist/ once
corepack pnpm@10 run watch   # rebuild dist/ on change
```

To try it inside a real Strapi app, point the app's dependency at your local checkout
(`pnpm add link:../strapi-plugin-ai-content-studio`), then run the app's `develop`. The server loads
`dist/server`; restart the app to pick up server changes.

---

## Architecture

```
server/src/
  content-types/          4 hidden plugin types: chat-thread, chat-message,
                          change-set, preview-session (invisible to the Content
                          Manager and CTB, so generic RBAC is not a second door)
  services/crypto.ts      AES-256-GCM encrypt/decrypt/mask + AI_STUDIO_ENC_KEY
                          validation + HMAC preview-token sign/verify
  services/redact.ts      ONE secret-redaction implementation, shared by the
                          stream error path and token logging
  services/config.ts      plugin-store config + typed preview/attachment/grounding
                          options + the single grounding precedence rule
  services/providers.ts   THE provider table: static imports + declared
                          capabilities. The only file that knows a provider's name
  services/registry.ts    per-request resolution of the active provider from
                          persisted config -> a chat-model instance
  services/agent.ts       the per-request agent + the model-call ceiling
  services/prompt.ts      sectioned instructions, in a fixed declared order, with a
                          version derived from their own text
  services/grounding.ts   the deterministic, permission-scoped, size-bounded
                          description of this install's schema
  services/threads.ts     owner-scoped conversations, message append, condensing
  services/change-sets.ts propose -> apply -> publish, the seven-step gate,
                          the ONLY write path
  services/preview.ts     preview sessions, overlay payload, staged file bytes
  services/attachments.ts limits, manifest validation, idempotent ingestion
  services/tools.ts       one tool set: listContentTypes, searchEntries, getEntry,
                          describePageStructure, proposeChanges
  middlewares/preview-overlay.ts  content-API response overlay, inert without a token
  controllers/            chat, threads, change-sets, attachments, preview, settings
  routes/index.ts         type:'admin' routes under /ai-content-studio/*
  routes/preview.ts       the single token-gated non-admin route (staged files)
  policies/               is-super-admin
admin/src/
  index.ts                addMenuLink (Chat) + addSettingsLink (Settings)
  pages/Chat.tsx          page shell: transport + useChat + wiring
  pages/Settings.tsx      provider/model/base-URL fields, masked write-only keys,
                          the grounding toggle and its inspector
  components/             ThreadSidebar, MessageList, Composer, CopyButton,
                          ChangePlanCard, PreviewPanel
  hooks/                  useThreads, useChangeSet, useAttachments, useCopy
  data/models.ts          curated per-provider model lists (edit me)
  data/providers.ts       the shipped-provider catalog (a SEPARATE module — see
                          the parseability note in models.ts)
```

Four pure-function suites live beside the code they cover — `providers.test.ts`, `config.test.ts`,
`prompt.test.ts`, `grounding.test.ts`. They are excluded from the published `dist/`.

## License

MIT © The Full Circle Development
