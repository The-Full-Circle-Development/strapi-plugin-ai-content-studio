# Implementation Plan: Preview, Persistent Chat, Deferred Attachments & Audit Modes

**Branch**: `main` (this repository commits directly to `main`; feature directory
`specs/001-preview-chat-attachments-audit`) | **Date**: 2026-08-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-preview-chat-attachments-audit/spec.md`

## Summary

Turn the assistant from an actor into a proposer, and give the panel a memory.

The load-bearing change is structural: the model loses every write tool. `createEntry`, `updateEntry`
and `publishEntry` are replaced by one `proposeChanges` tool that persists a **pending change set** and
returns a plan; the only code path that mutates content is `POST /change-sets/:id/apply`, driven by the
user's click, which re-checks permissions, re-checks a per-field staleness fingerprint, demands explicit
confirmation for destructive items, and reports a per-item outcome. Everything else in the feature hangs
off that pending change set: **live preview** overlays it onto content-API responses behind a signed,
30-minute token so the real front-end renders proposed values while the database is untouched;
**deferred attachments** ride it as ordinals (`#1`, `#2`) and are ingested into the Media Library only
at apply time; **modes** narrow the tool set per request, with `audit` mode simply not building
`proposeChanges` at all.

Alongside it, conversations become durable: four hidden plugin content types (`chat-thread`,
`chat-message`, `change-set`, `preview-session`) give per-user threads that survive reloads and
restarts, scoped by an owner id the server derives and never accepts from the client — a thread of
another user is a `404`, super-admin included. Stopping a generation now aborts the server-side stream
via an `AbortController` tied to the request, persisting the partial turn as interrupted. Finally, two
read-only tools available in `audit` mode inspect the **running configuration** — never project source
files — for functional defects (dangling relations, missing media, required-empty, broken components)
and security problems (public-role writes, unauthenticated endpoints, unsafe upload rules, debug flags,
secret-like stored values), with evidence masked at the tool boundary and the security audit gated
behind a new `audit.run` permission.

## Technical Context

**Language/Version**: TypeScript 5 on Node `>=20.0.0 <=24.x.x`, CommonJS package type; React 18 for the
admin bundle.

**Primary Dependencies**: no new runtime dependencies. Existing set only — Vercel AI SDK v6 (`ai`,
`@ai-sdk/react`, `@ai-sdk/{anthropic,google,openai}`), `@strapi/strapi` v5, `@strapi/design-system` v2 +
`@strapi/icons` v2, `zod` v4, `styled-components`, `react-markdown` + `remark-gfm`, and Node's built-in
`crypto`. AI SDK capabilities this plan relies on (`abortSignal`, `onAbort({ steps })`, `onFinish`,
`originalMessages`, `generateMessageId`, `consumeSseStream`) were verified present in the committed
`dist/server` bundle that ships to consumers.

**Storage**: four plugin content types hidden from the Content Manager and the Content-Type Builder
(`chat-thread`, `chat-message`, `change-set`, `preview-session`), on whatever database the host project
uses; change items are a JSON column. Provider settings stay in the plugin store. Staged preview file
bytes live in the creating instance's memory; held attachment bytes live in the browser.

**Testing**: no automated suite exists. The gate is `pnpm run typecheck` plus the manual verification
script in [quickstart.md](./quickstart.md) run in a real admin panel, including the ten
permission-denied paths in [contracts/permissions.md](./contracts/permissions.md) (Constitution V).

**Target Platform**: Strapi v5 admin panel (browser) + Strapi v5 server, consumed as a git dependency
with a committed `dist/`. Preview additionally touches the consuming project's front-end, which must
forward one token — contract in
[contracts/preview-integration.md](./contracts/preview-integration.md).

**Project Type**: Strapi plugin — a server half (`server/src`, layered services → controllers → routes →
policies, plus new `content-types/` and `middlewares/`) and an admin half (`admin/src`), built into a
committed `dist/`.

**Performance Goals**: first streamed token within ~2 s of send (unchanged); thread list and full
history rendered within 5 s of opening the panel (SC-005); Stop halts visible output within 2 s
(SC-007); QA or security pass completes within a 2-minute budget and states its coverage for projects up
to 50 content types (SC-012); the preview overlay adds no more than a few milliseconds and one database
read per validated content-API request, and rejects an invalid token before any database access.

**Constraints**: no new required env var — the preview token key is a labelled subkey derived from the
existing `AI_STUDIO_ENC_KEY`, and every new config option defaults to today's behaviour so an upgrade is
a no-op (FR-054); no new UI dependency in the admin bundle; all plugin admin routes stay
`type: 'admin'` under `/ai-content-studio/*`, with two token-gated preview surfaces as a justified
deviation (see Complexity Tracking); secrets masked before any tool result reaches the model; content
mutation only via the apply route.

**Scale/Scope**: 8 user stories, 54 functional requirements. Projects up to ~50 content types and a few
hundred threads per user; per-conversation attachment budget 50 MB; 30-minute lifetime for pending change
sets and previews. Roughly 6 new server services, 4 new controllers, 1 middleware, 4 content types, 1
policy, and an admin page split into ~6 components plus 3 hooks. `admin/src/pages/Chat.tsx` (814 lines
today) is decomposed as part of the work.

No `NEEDS CLARIFICATION` items remain: the three open interpretations were decided in the spec
(D1–D3) and every technical unknown is resolved in [research.md](./research.md) (R1–R14).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constitution v1.0.0. **Initial evaluation: PASS with one recorded deviation** (public preview
surfaces). **Post-design re-evaluation: unchanged — PASS with the same single deviation**, now fully
specified in [contracts/preview-integration.md](./contracts/preview-integration.md).

### I. Secrets Are Encrypted And Never Echoed (NON-NEGOTIABLE) — PASS

- No change to key storage, masking, or the write-only settings API.
- The preview token needs a signing key: derived as a **labelled subkey of `AI_STUDIO_ENC_KEY`** inside
  `services/crypto.ts`, so crypto stays isolated (R11) and no second secret is introduced. Rotation
  invalidates outstanding 30-minute previews — harmless, and covered by the existing README note.
- New leak surface identified and closed: the **security audit** would otherwise hand secret-like values
  to the provider. Masking happens at the tool boundary, before the result leaves the tool, so nothing
  key-shaped reaches the model, the persisted transcript, or a log line (FR-049).
- `redactSecrets` moves out of `controllers/chat.ts` into a shared helper so the audit, the stream error
  path, and preview-token logging use one implementation. Preview tokens are treated as key-like.
- Persisted `chat-message.parts` store the same masked, truncated tool results the model received, so
  replaying history cannot surface what the live call withheld.

### II. Per-Caller RBAC On Every Content Tool (NON-NEGOTIABLE) — PASS (strengthened)

- The four existing tool rules are preserved for every tool, new ones included.
- The feature *tightens* this principle: writes are checked twice — at propose and again at apply
  against the caller's live ability — and the apply route is deterministic server code, so there is no
  path from a model tool to a content mutation at all (R1).
- Modes only ever narrow the tool set; they never grant anything the caller lacks (FR-031).
- Thread ownership is server-derived and enforced as `404`, with no super-admin exemption (FR-017).
- Security audit is gated by the new `audit.run` action; settings routes remain super-admin only and
  untouched; `chat.use` still gates chat.
- Attachment ingestion checks Media Library create permission before writing a byte.
- Full matrix: [contracts/permissions.md](./contracts/permissions.md).

### III. Provider Neutrality, Runtime Switchable — PASS

- Plan, apply, preview, persistence, modes, QA, and audit are all provider-independent server logic.
  Nothing branches on provider identity.
- Vision remains the one capability difference and it degrades explicitly: the attachment **manifest**
  reaches the model as text on every provider, so `#1 → hero` placement works even where image bytes are
  not sent, and the UI says visual analysis is unavailable (FR-036, FR-052).
- Abort works identically across providers via `abortSignal`.
- Model lists stay curated in `admin/src/data/models.ts`; nothing is fetched from a provider.
- Thread-context condensing uses the active provider — no second provider is introduced.

### IV. Self-Contained Distribution — PASS

- Zero new dependencies, so `dist/` gains no new bundled surface beyond this feature's own code.
- `dist/` is rebuilt and staged in the same commit as every `admin/`/`server/` change; one task per
  commit.
- README updates ship with the change that needs them: the `audit.run` permission, preview
  configuration + front-end contract, thread privacy semantics, and the recorded v1 limitations.
- New content types sync on boot; no consumer migration step, no build step.

### V. Verified In A Real Admin Panel — PASS

- [quickstart.md](./quickstart.md) is the verification script: 10 scenarios mapped to requirements and
  success criteria, each naming what "fails if" looks like.
- Every content-affecting capability has at least one permission-denied path in the required set of ten.
- `pnpm run typecheck` clean before each commit; bug fixes state the reproduction actually run.

### Technology & Security Constraints — PASS with one deviation

| Constraint | Verdict |
|-----------|---------|
| Strapi v5, Node 20–24, CommonJS, React 18 | unchanged |
| pnpm 10 | unchanged |
| TypeScript, no new `any` in exported signatures, `zod` on every tool input and payload | new tools, routes, and request bodies all zod-validated |
| `@strapi/design-system` v2 + `@strapi/icons` v2 only | thread sidebar, mode selector, plan card, and preview panel built from the design system; no new UI dependency |
| All plugin routes `type: 'admin'` under `/ai-content-studio/*`; no public route exposes chat, tools, or settings | **Deviation**: two non-admin preview surfaces (content-API overlay middleware, staged-file route). Neither exposes chat, tools, or settings. See Complexity Tracking. |
| Server layering services → controllers → routes → policies preserved; crypto isolated | preserved; `content-types/` and `middlewares/` added as sibling layers; HMAC derivation lives in `services/crypto.ts` |
| Plugin config in the plugin store; new settings have safe defaults | all six new options default to current behaviour; preview is opt-in and off |

### Complexity rule — PASS

Three structures are added deliberately and each is justified in Complexity Tracking below; nothing
else is introduced. Change items are a JSON column rather than a fifth content type; audit reports are
not persisted at all; no queue, cache, or storage service is added.

## Project Structure

### Documentation (this feature)

```text
specs/001-preview-chat-attachments-audit/
├── spec.md              # Feature specification (/speckit-specify)
├── plan.md              # This file (/speckit-plan)
├── research.md          # Phase 0 output — R1..R14 decisions
├── data-model.md        # Phase 1 output — entities, states, invariants
├── quickstart.md        # Phase 1 output — manual verification script (the quality gate)
├── contracts/           # Phase 1 output
│   ├── admin-api.md            # admin routes: threads, chat, change sets, attachments
│   ├── preview-integration.md  # front-end contract + the two non-admin surfaces
│   ├── model-tools.md          # tools per mode + system-prompt changes
│   └── permissions.md          # RBAC actions, enforcement matrix, denied-path checklist
├── checklists/
│   └── requirements.md  # spec quality checklist (all items pass)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
server/src/
├── content-types/                  # NEW layer — hidden plugin content types
│   ├── index.ts
│   ├── chat-thread/schema.json
│   ├── chat-message/schema.json
│   ├── change-set/schema.json
│   └── preview-session/schema.json
├── middlewares/                    # NEW layer
│   ├── index.ts
│   └── preview-overlay.ts          # content-API response overlay, inert without a valid token
├── services/
│   ├── crypto.ts                   # + labelled subkey derivation, HMAC sign/verify (R11)
│   ├── redact.ts                   # NEW — shared secret redaction (moved out of controllers/chat.ts)
│   ├── config.ts                   # + preview / attachments / audit option accessors
│   ├── registry.ts                 # unchanged
│   ├── threads.ts                  # NEW — owner-scoped CRUD, message append, context condensing
│   ├── change-sets.ts              # NEW — propose, fingerprint, apply, reject, expire
│   ├── preview.ts                  # NEW — sessions, overlay payload, staged files, token issue/verify
│   ├── attachments.ts              # NEW — limits, idempotent ingestion, manifest validation
│   ├── audit-qa.ts                 # NEW — read-only functional checks (R7)
│   ├── audit-security.ts           # NEW — read-only configuration checks (R8)
│   ├── tools.ts                     # read tools + describePageStructure + proposeChanges, per mode
│   └── index.ts
├── controllers/
│   ├── chat.ts                     # + threadId/mode/manifest, abort wiring, turn persistence
│   ├── threads.ts                  # NEW
│   ├── change-sets.ts              # NEW — get / apply / reject / preview
│   ├── attachments.ts              # NEW — limits / ingest
│   ├── preview.ts                  # NEW — staged-file serving (non-admin, token-gated)
│   ├── settings.ts                 # unchanged
│   └── index.ts
├── policies/
│   ├── is-super-admin.ts           # unchanged
│   ├── has-audit-permission.ts     # NEW
│   └── index.ts
├── routes/
│   ├── index.ts                    # admin routes (existing + new)
│   ├── preview.ts                  # NEW — the single token-gated non-admin route
│   └── ...
├── bootstrap.ts                    # + register the audit.run permission action
├── register.ts                     # unchanged (key assertion)
└── config/index.ts                 # + preview.*, attachments.*, audit.* with safe defaults

admin/src/
├── pages/
│   ├── Chat.tsx                    # reduced to a shell (from 814 lines)
│   └── Settings.tsx                # unchanged
├── components/                     # NEW
│   ├── ThreadSidebar.tsx
│   ├── ModeSelect.tsx
│   ├── MessageList.tsx
│   ├── Composer.tsx                # attachments held in browser memory, no upload on send
│   ├── ChangePlanCard.tsx          # per-item selection, destructive confirm, outcomes
│   └── PreviewPanel.tsx            # preview action + field-diff fallback
├── hooks/                          # NEW
│   ├── useThreads.ts
│   ├── useChangeSet.ts
│   └── useAttachments.ts
├── data/models.ts                  # unchanged (curated lists)
└── ...

dist/                               # rebuilt and committed with every source change
README.md                           # updated in the same commits (permission, preview, limits)
```

**Structure Decision**: keep the existing two-half plugin layout and the server's
services → controllers → routes → policies layering, adding `content-types/` and `middlewares/` as
sibling layers under `server/src/` — both are standard Strapi plugin slots, so this introduces no new
architectural concept. Business logic stays in services (the controllers are thin, as today), which is
what lets the apply path be reused by the route without the model ever reaching it. On the admin side
the single 814-line `Chat.tsx` becomes a shell over `components/` + `hooks/`, because this feature adds
a thread sidebar, a mode selector, a plan card with per-item approval, and a preview panel to a file
already at its comprehension limit (R12). No new top-level directory, no new package, no new
dependency.

## Complexity Tracking

> Three deliberate deviations from the simplest possible design. Each is required by a specific
> requirement and each was weighed against a simpler option.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| **Two non-admin HTTP surfaces for preview** — a content-API response-overlay middleware and a token-gated staged-file route — against the constraint that all plugin routes are `type: 'admin'` | FR-010..FR-013 require the *real front-end* to render values that are not in the database. A site renders server-side and in the browser with no admin session, so it cannot call an `admin::isAuthenticatedAdmin` route. Compensating controls: `preview.enabled` defaults to **false**; both surfaces are inert without an HMAC-signed token bound to `{ sessionId, ownerId, changeSetId, exp }`; 30-minute TTL; valid only while the change set is `pending`; revoked on apply/reject/expiry/thread deletion; no enumeration or listing endpoint; strictly read-only; `Cache-Control: no-store`; an invalid token is ignored rather than erroring, so it cannot be used to probe. Neither surface exposes chat, tools, or settings — the letter of the constraint holds; the deviation is against its spirit and is recorded here. | *Admin-only preview route*: unreachable by the front-end — the capability cannot exist. *Strapi native Preview*: previews a draft, so content is persisted before approval, contradicting spec decision D1 — the entire point of the story. *Proxy the site's HTML through the plugin*: brittle against hydration, assets, and routing, and a worse security surface than a signed read-only overlay. |
| **Four new plugin content types** (`chat-thread`, `chat-message`, `change-set`, `preview-session`) | FR-016 (survive reloads/restarts), FR-017 (per-user isolation), FR-008 (auditable approvals), and the multi-instance requirement for preview sessions all need durable, queryable, owner-scoped storage. Kept to the minimum: change items are a JSON column rather than a fifth type, and audit reports are not persisted at all. | *Plugin store JSON blob per user*: no querying, unbounded row growth, write contention between browser tabs. *In-memory*: fails restart and multi-instance. *Browser storage*: fails FR-016 outright and does not follow the user across devices. *A fifth `change-item` type*: items are only ever read and written as a whole set — a table and a join for no benefit. |
| **Propose→apply indirection replacing direct write tools** | FR-001 requires that no write can happen without explicit approval and FR-004 requires permissions re-checked at apply time. Making apply a plain route removes any code path from the model to the Document Service, so the guarantee is structural rather than prompt-shaped; it is also where staleness checks, destructive confirmation, and per-item outcomes naturally live. | *Prompt-based confirmation* or *AI SDK human-in-the-loop tool confirmation*: the write still executes inside the model's step loop, so the guarantee depends on the model behaving — protection against accidents, not against the model. *Write-then-offer-undo*: persists content before approval (contradicts D1) and cannot undo a publish cleanly. |

**Accepted v1 limitations** (from [research.md](./research.md#r14--accepted-limitations-recorded-so-they-are-not-rediscovered-as-bugs), to be stated in the README rather than
rediscovered as bugs): GraphQL content API is not overlaid (those projects get the field-diff fallback);
staged preview media is served from the creating instance's memory, so multi-instance deployments may
show the current image instead of the proposed one and a restart expires previews early; held
attachments do not survive a panel reload by design; audits never read project source files (D2).
