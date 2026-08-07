# strapi-plugin-ai-content-studio

A multi-provider AI assistant embedded in the **Strapi v5** admin panel. Editors manage content
(find / read / create / edit / publish) through natural-language chat with tool calling, and a
super-admin settings page switches the AI provider + model and manages API keys **without
redeploying**.

- **Providers:** Anthropic, Google, OpenAI — switchable from the UI (Vercel AI SDK v6).
- **Streaming chat** with multi-step tool calling over Strapi's Document Service.
- **Nothing is written without approval.** The assistant has no write tools. It *proposes* a change
  plan; the only code path that mutates content is an admin route driven by your click.
- **Live preview** of a pending plan on your real front-end, before anything is saved.
- **Persistent per-user conversations** that survive reloads and restarts.
- **Deferred media ingestion:** attached files stay in your browser and enter the Media Library only
  when you approve the plan that uses them.
- **Read-only QA and security audits** of the running configuration.
- **Per-caller RBAC:** every content tool is gated by the calling admin's content-manager
  permissions — the assistant can never do more than the user could in the Content Manager.
- **Encrypted keys at rest** (AES-256-GCM); the settings API returns a mask only, never the key.
- **Self-contained:** the AI SDK is bundled into the shipped `dist/`. Consumers don't install any
  AI dependencies and don't run a build step.

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
- **Security audit**: grant `Plugins → AI Content Studio → Run AI Content Studio security audit`
  (`audit.run`). **New, and super-admin only by default.** An audit report is a map of a project's
  weak points, so it is treated as need-to-know: a caller without this action gets a refusal with no
  counts, no categories, and no partial findings. The *functional QA* pass needs no extra action —
  it is bounded by the caller's existing read permissions.
- **Settings** (provider/model + keys): **super-admin only**, enforced by route policy + the
  settings link permission. Keep the settings actions assigned to super-admin only.

Content operations are always bounded by the caller's own content-manager permissions, checked
twice for a write: once when the plan is proposed, and again against the caller's live ability at
the moment of apply.

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
- **Audits inspect the running configuration, never project source files.** Content types,
  components, relations, media references, role permissions, plugin settings, and existing content
  data — not files on disk.
- **There is still no automated test suite.** Verification is manual, in a running admin panel.

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
live in [`admin/src/data/models.ts`](admin/src/data/models.ts):

```ts
export const MODELS: Record<ProviderId, ModelOption[]> = {
  anthropic: [{ id: 'claude-opus-4-8', label: 'Claude Opus 4.8' }, /* … */],
  openai:    [{ id: 'gpt-4.1', label: 'GPT-4.1' }, /* … */],
  google:    [{ id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' }, /* … */],
};
```

`id` is the string passed straight to the provider's API; `label` is the dropdown caption. Edit the
map, then **release** (below). All consuming projects pick up the new list on their next update +
redeploy.

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
                          stream error path, the audits, and token logging
  services/config.ts      plugin-store config + typed preview/attachment/audit options
  services/registry.ts    per-request provider/model builder (createProviderRegistry)
  services/prompt.ts      system prompt: shared base + one per-mode section
  services/threads.ts     owner-scoped conversations, message append, condensing
  services/change-sets.ts propose -> apply, the six-step gate, the ONLY write path
  services/preview.ts     preview sessions, overlay payload, staged file bytes
  services/attachments.ts limits, manifest validation, idempotent ingestion
  services/audit-qa.ts    read-only functional checks
  services/audit-security.ts read-only configuration checks, masked at the boundary
  services/tools.ts       read tools + describePageStructure + proposeChanges +
                          runQaScan + runSecurityAudit, selected per mode
  middlewares/preview-overlay.ts  content-API response overlay, inert without a token
  controllers/            chat, threads, change-sets, attachments, preview, settings
  routes/index.ts         type:'admin' routes under /ai-content-studio/*
  routes/preview.ts       the single token-gated non-admin route (staged files)
  policies/               is-super-admin, has-audit-permission
admin/src/
  index.ts                addMenuLink (Chat) + addSettingsLink (Settings)
  pages/Chat.tsx          page shell: transport + useChat + wiring
  pages/Settings.tsx      provider/model dropdowns + masked write-only key fields
  components/             ThreadSidebar, ModeSelect, MessageList, Composer,
                          ChangePlanCard, PreviewPanel, AuditReportCard
  hooks/                  useThreads, useChangeSet, useAttachments
  data/models.ts          curated per-provider model lists (edit me)
```

## License

MIT © The Full Circle Development
