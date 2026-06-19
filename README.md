# strapi-plugin-ai-content-studio

A multi-provider AI assistant embedded in the **Strapi v5** admin panel. Editors manage content
(find / read / create / edit / publish) through natural-language chat with tool calling, and a
super-admin settings page switches the AI provider + model and manages API keys **without
redeploying**.

- **Providers:** Anthropic, Google, OpenAI — switchable from the UI (Vercel AI SDK v6).
- **Streaming chat** with multi-step tool calling over Strapi's Document Service.
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
  services/crypto.ts      AES-256-GCM encrypt/decrypt/mask + AI_STUDIO_ENC_KEY validation
  services/config.ts      plugin-store config (get/set/getDecryptedKey/getMaskedConfig)
  services/registry.ts    per-request provider/model builder (createProviderRegistry)
  services/tools.ts       6 permission-gated content tools
  controllers/chat.ts     streaming chat controller (pipeUIMessageStreamToResponse)
  controllers/settings.ts GET masked config / PUT write-only save
  routes/index.ts         type:'admin' routes (/chat editors, /settings super-admin)
  policies/is-super-admin.ts
admin/src/
  index.ts                addMenuLink (Chat) + addSettingsLink (Settings)
  pages/Chat.tsx          useChat + streamed text/tool parts
  pages/Settings.tsx      provider/model dropdowns + masked write-only key fields
  data/models.ts          curated per-provider model lists (edit me)
```

## License

MIT © The Full Circle Development
