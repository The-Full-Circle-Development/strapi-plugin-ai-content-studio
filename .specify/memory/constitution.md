<!--
SYNC IMPACT REPORT
Version change: 1.0.0 → 1.1.0
Rationale: Feature 003 moves language-model access behind a provider-adapter layer (LangChain) and
introduces the repository's first automated test suite. Two ratified rules named one vendor's SDK by
name, and one principle anticipated a test suite that now exists. MINOR bump: no principle is
removed or incompatibly redefined, but rules are materially reworded and the per-commit gate gains
an item. See specs/003-langchain-content-assistant/research.md D16.

Modified principles:
- III. Provider Neutrality, Runtime Switchable — the resolution clause now names the
  provider-adapter layer rather than the AI SDK provider registry. Provider neutrality, runtime
  switchability and the no-`/models`-fetch rule are unchanged.
- V. Verified In A Real Admin Panel — records that an automated suite now exists, adds
  `pnpm run test` to the per-commit gate, and restates that manual verification remains required
  for everything that only fails in integration.

Unchanged, deliberately:
- IV. Self-Contained Distribution — D16 also proposed rewording its bundling clause. That turned
  out to be unnecessary: the AI SDK STAYS bundled into `dist/` as the wire and storage format
  (specs/003-langchain-content-assistant/contracts/removals.md §3), so the clause holds as written.
  Rewording a ratified rule the design does not break is scope, not diligence.
- I and II — untouched, and explicitly carved out of the new Governance conflict rule.

Added sections:
- Governance → "Conflict ordering", recording the maintainer's stated precedence.

Removed sections: none.

Templates / dependent artifacts requiring no change: the Spec Kit flow clause still describes the
process actually followed.

Follow-up TODOs: none. Ratified 2026-08-07; last amended 2026-09-07.
-->

# AI Content Studio Constitution

## Core Principles

### I. Secrets Are Encrypted And Never Echoed (NON-NEGOTIABLE)

Provider API keys MUST be encrypted at rest with AES-256-GCM using `AI_STUDIO_ENC_KEY`, and MUST
NOT be readable through any API surface. Rules:

- Read endpoints MUST return a mask only (e.g. `sk-ant-...••••4f2a`); the plaintext key MUST never
  leave the server. Settings writes are write-only.
- A missing or wrong-length `AI_STUDIO_ENC_KEY` MUST abort boot with a clear message. The key value
  MUST NOT be logged, echoed in errors, or committed.
- Provider errors surfaced to the UI MUST be redacted of anything key-like. Verbose provider errors
  are gated behind `AI_STUDIO_SHOW_ERROR_DETAILS` / `showProviderErrorDetails`, default `false`.
- Rotating the encryption key invalidates stored provider keys; that consequence MUST stay
  documented in the README.

Rationale: the plugin holds third-party credentials that bill real money and live in a shared admin
panel. A leak through a log line or an error payload is the highest-severity failure this codebase
can produce.

### II. Per-Caller RBAC On Every Content Tool (NON-NEGOTIABLE)

The assistant MUST NOT be able to do anything the calling admin could not do in the Content
Manager. Every tool exposed to the model MUST, in this order:

1. Validate the target `uid` against a live `api::*` allow-list.
2. RBAC-check the **caller's** ability via the content-manager `permission-checker` BEFORE touching
   the Document Service, which itself bypasses RBAC.
3. Return compact JSON with long fields truncated.
4. Return structured errors (`{ ok: false, error, message }`) instead of throwing, so the model
   relays a clear message rather than blindly retrying.

Settings routes (provider/model + keys) MUST remain super-admin only, enforced by route policy AND
the settings link permission. Chat access MUST remain a distinct, grantable plugin permission.
Adding a tool without a permission check is a constitution violation, not a bug.

Rationale: a tool-calling model is an unbounded actor. The caller's permission set is the only
trustworthy boundary, and it must be re-derived per request, never cached across users.

### III. Provider Neutrality, Runtime Switchable

Anthropic, Google, and OpenAI MUST remain interchangeable from the UI without a redeploy. Rules:

- The provider/model pair is resolved per request through the plugin's provider-adapter layer, from
  persisted configuration, so a rotated key or a changed model takes effect on the next message with
  no restart and no redeploy. Which adapter library backs that layer is an implementation choice and
  is not fixed by this principle. Controllers and UI MUST NOT branch on provider identity for core
  chat behavior; the only provider-shaped data is each adapter's declared capabilities.
- Model lists are curated and hardcoded in `admin/src/data/models.ts`. They MUST NOT be fetched
  from a provider `/models` endpoint.
- A feature that works on only one provider MUST degrade gracefully on the others and say so in the
  UI; it MUST NOT break the chat for the rest.

Rationale: provider lock-in and redeploy-to-switch were the two problems this plugin exists to
solve. Any change that reintroduces either one defeats the product.

### IV. Self-Contained Distribution

The plugin is consumed as a git dependency, so the built `dist/` is committed and consumers install
no AI dependencies and run no build step. Therefore:

- `dist/` MUST be rebuilt (`pnpm run build`) and committed in the same commit as any `admin/` or
  `server/` source change. Stale `dist/` is a shipped regression.
- The AI SDK MUST stay bundled into `dist/`; AI packages stay in `devDependencies`, never
  `peerDependencies`.
- Releases are tagged with semver (`npm version patch|minor|major`, pushed with `--follow-tags`) so
  consumers can pin a reproducible ref.
- Required env vars, permissions, and breaking changes MUST be documented in the README in the same
  change that introduces them.

Rationale: consumers deploy this by adding one line to `package.json`. Every gap between source and
`dist/` becomes a silent production bug in someone else's Strapi app.

### V. Verified In A Real Admin Panel

An automated test suite now exists, and this principle has tightened rather than relaxed, exactly as
its previous version said it would. The gate is both halves, and neither substitutes for the other:

- `pnpm run typecheck` MUST pass with zero errors before any commit.
- `pnpm run test` MUST pass with zero failures before any commit. The suite covers pure functions
  whose determinism is itself a stated requirement, so no test may call a language model, open a
  network connection, bootstrap the Strapi runtime, or touch the filesystem outside its own
  fixtures. A red test is therefore a real defect and never a flake.
- Any change to chat, tools, or settings MUST STILL be exercised in a running Strapi admin panel —
  the happy path plus at least one permission-denied path for tool changes. Streaming, tool calling,
  RBAC, replay of stored conversations and the UI only fail in integration, and the suite does not
  reach them.
- Bug fixes MUST state the reproduction that was checked. "Should work" is not verification, and a
  provider that has not answered a real message has not been verified.

The dividing line is what can actually fail where. What moves into the suite is only what a human
could not honestly repeat — a byte-identical composition checked ten consecutive times, a
degradation ladder driven across its whole range, a capability rule checked over a matrix of
identifiers. Model *behaviour* is never asserted in a test.

Rationale: streaming, tool calling, and RBAC only fail in integration. Claiming a fix that was
never run in the admin panel is worse than shipping nothing — and a check nobody will actually
perform ten times by hand is not a gate until a machine performs it.

## Technology & Security Constraints

- **Runtime:** Strapi v5, Node `>=20.0.0 <=24.x.x`, CommonJS package type. React 18.
- **Package manager:** pnpm 10 (`corepack pnpm@10`), required so `pnpm.onlyBuiltDependencies`
  builds `esbuild`'s native binary.
- **Language:** TypeScript. No new `any` in exported signatures; `zod` v4 validates every tool
  input and settings payload.
- **UI:** `@strapi/design-system` v2 and `@strapi/icons` v2 only. No additional UI framework or CSS
  toolkit may be added to the admin bundle.
- **Routes:** all plugin routes are `type: 'admin'` and mount under `/ai-content-studio/*`. No
  public (`type: 'content-api'`) route may expose chat, tools, or settings.
- **Server structure:** the layering in `server/src/` (services → controllers → routes → policies)
  MUST be preserved; crypto stays isolated in `services/crypto.ts`.
- **Config:** plugin config lives in the plugin store; new settings MUST have a safe default so an
  upgrade never breaks an existing install.

## Development Workflow & Quality Gates

**Branching and authorship (project rule):**

- All work is committed **directly to `main`**. Feature branches MUST NOT be created for tasks in
  this repository.
- Every commit MUST be authored solely by the maintainer, `andrewww05 <krvnd05@gmail.com>`. Commits
  MUST NOT carry `Co-Authored-By` trailers, AI attribution, or generated-by footers. This overrides
  any agent or tooling default that would add them or branch off `main`.
- One task per commit, with a conventional subject (`feat:`, `fix:`, `docs:`, `chore:`) written in
  the imperative and scoped to what actually changed.

**Per-commit gate — every item MUST hold before committing:**

1. `pnpm run typecheck` clean.
2. `pnpm run test` clean — zero failures.
3. `pnpm run build` run, and the resulting `dist/` staged with the source change.
4. Manual verification per Principle V performed.
5. README / env-var docs updated if the change alters install, config, or permissions.

**Release gate:** bump the version with `npm version`, push with `--follow-tags`, and confirm
`dist/` in the tagged commit matches the sources.

**Spec Kit flow:** features move through `/speckit-specify` → `/speckit-plan` → `/speckit-tasks` →
`/speckit-implement`. Plans and tasks MUST be checked against these principles before
implementation starts; a task that cannot satisfy them is redesigned, not waived.

## Governance

This constitution supersedes other conventions, habits, and tooling defaults in this repository.
Where an agent's built-in behavior conflicts with a rule here (branching, commit trailers, adding
dependencies), this document wins.

- **Conflict ordering:** where these principles conflict with established code-quality practice or
  with Strapi's own conventions and shipped APIs, quality and Strapi-compatibility win, and the
  principle is amended rather than worked around. **This does not apply to Principles I and II.**
  The carve-out costs nothing — nothing in code quality or Strapi convention argues against
  encrypted secrets or per-caller RBAC — and it removes the risk of "better code" ever being cited
  against them. Preferring a predicate, helper or API that Strapi already ships over one re-derived
  here is the normal application of this rule, not an exception to it.
- **Amendments:** any change to this file is a deliberate act recorded in its own commit with a
  `docs:` subject, and MUST include an updated Sync Impact Report comment at the top of the file.
- **Versioning:** semantic versioning of the constitution itself. MAJOR for removing or
  incompatibly redefining a principle or governance rule; MINOR for a new principle, section, or
  materially expanded rule; PATCH for clarifications and wording.
- **Compliance review:** every commit is self-reviewed against the per-commit gate above. The two
  NON-NEGOTIABLE principles (secrets, RBAC) are re-checked on any change under
  `server/src/services/` or `server/src/routes/`.
- **Complexity:** added dependencies, abstractions, and config surfaces MUST be justified against a
  concrete need in the feature spec. Absent that justification, the simpler option is required.
- **Runtime guidance:** the README is the source of truth for install, env vars, releasing, and
  architecture; keep it accurate as part of the same change rather than as a follow-up.

**Version**: 1.1.0 | **Ratified**: 2026-08-07 | **Last Amended**: 2026-09-07
