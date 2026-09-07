---
description: "Task list for feature 003 — Unified Provider Layer, Single Content Mode & Project-Grounded Prompt"
---

# Tasks: Unified Provider Layer, Single Content Mode & Project-Grounded Prompt

**Input**: Design documents from `/specs/003-langchain-content-assistant/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: this feature **introduces the repository's first automated tests** — four suites over the
pure functions it adds. They exist because three of its requirements cannot honestly be proved by
looking at a screen once: FR-018's byte-identical composition (ten consecutive runs), FR-032's
deterministic degradation across tiers, and FR-006's per-provider image rule across a matrix of
identifiers. A scenario a human will not actually repeat ten times is not a gate.

The suites are **T005a, T014a, T052a and T060a**, and each lives in the phase that writes the code it
covers — not in a phase of its own. The `a` suffix marks a task added after the original numbering,
so every existing task id and cross-reference stays valid.

Everything that only fails in integration — streaming, tool activity, stop, permission denials,
replay of pre-existing conversations, the UI — stays **manual**, in a running Strapi admin panel,
scripted in [quickstart.md](quickstart.md). Each story phase still ends with its own verification task
naming the exact quickstart scenarios that count as proof. The two are complements: the tests take
over only the checks that were unrepeatable by hand, and nothing else.

**Organization**: Tasks are grouped by user story so each story can be implemented, verified and
shipped independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1..US6)
- Every task names its exact file path

## Path Conventions

Strapi v5 plugin, two surfaces plus a committed build output:

- **Admin (React 18)**: `admin/src/`
- **Server (Node, CommonJS)**: `server/src/`
- **Built bundles**: `dist/` — committed, rebuilt and staged in the **same commit** as every source
  change (`corepack pnpm@10 run build`)

## The per-commit gate (applies to every phase)

Repeated as an explicit task at the end of each phase, because CLAUDE.md makes it non-optional. One
phase is one commit, with the two exceptions recorded in **Commit mapping** below: Phases 1-2 land
inside the provider-layer commit, and Phase 4 is the plan's items 4 and 5 together.

1. `corepack pnpm@10 run typecheck` clean — zero errors.
2. `corepack pnpm@10 run test` clean — zero failures. **No suite in it calls a language model**, so a
   red test is a real defect and never a flake (see Tests, above).
3. `corepack pnpm@10 run build`, with `dist/` staged alongside the source. Stale `dist/` is a
   shipped regression, not a follow-up.
4. The phase's manual verification observed in a running admin panel — not reasoned about.
5. The phase's `README.md` delta written in the same commit.
6. **Principles I and II re-checked** on any commit touching `server/src/services/` or
   `server/src/routes/` (Constitution Governance, NON-NEGOTIABLE).

## Standing rule that constrains several tasks

**No model identifier is written from memory.** This feature adds none: new providers use direct
identifier entry (FR-004), and the curated lists keep their single home,
[admin/src/data/models.ts](admin/src/data/models.ts). Two tasks below (T011, T014) touch that file's
neighbourhood — neither may append to it or restructure its `MODELS` literal, because
`.claude/hooks/session-model-context.mjs` parses it as text to end of file (research D15).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: land the blocking constitution amendment, move the dependency tree, and record the
baseline the bundle-growth risk is measured against.

- [ ] T001 Amend `.specify/memory/constitution.md` 1.0.0 → 1.1.0 in its **own `docs:` commit, before every other commit in this feature**, with four changes and no others:
  1. **Principle III** — reword the resolution clause ("The provider/model pair is resolved per request through the AI SDK provider registry") to name **the provider-adapter layer** rather than one vendor's SDK. Provider neutrality, runtime switchability and the no-`/models`-fetch rule stay intact (research D16).
  2. **Principle IV — left alone.** D16 also proposed rewording its bundling clause, and that turned out to be unnecessary: the AI SDK **stays** bundled into `dist/` as the wire and storage format (contracts/removals.md §3), so the clause holds as written. Rewording a ratified rule the design does not break is scope, not diligence.
  3. **Principle V** — it already anticipates this: "once a test suite exists it MUST pass and this principle tightens rather than relaxes." State that one now exists, that `corepack pnpm@10 run test` joins the per-commit gate, and that manual verification in a running admin panel remains required for everything that only fails in integration — streaming, tool calling, RBAC, replay and the UI. The suite complements the panel; it does not replace it.
  4. **Governance** — add the maintainer's stated conflict ordering: *where these principles conflict with established code-quality practice or with Strapi's own conventions and shipped APIs, quality and Strapi-compatibility win, and the principle is amended rather than worked around. This does not apply to Principles I and II.* The carve-out costs nothing — nothing in code quality or Strapi convention argues against encrypted secrets or per-caller RBAC — and it removes the risk of "better code" ever being cited against them.

  Then update the Sync Impact Report comment at the top of the file, the per-commit gate list, and the `**Version**` / `**Last Amended**` footer. Cite clauses by their text, not by line number — the Sync Impact Report edit shifts every line below it
- [ ] T002 Add the LangChain tree to `devDependencies` in `package.json` at the versions verified in research D8 — `langchain@1.5.10`, `@langchain/core@1.2.9`, `@langchain/anthropic@1.5.9`, `@langchain/openai@1.5.11`, `@langchain/google-genai@2.3.0`, `@ai-sdk/langchain@3.0.93` — never `peerDependencies` (Principle IV), then `corepack pnpm@10 install`
- [ ] T003 Remove `@ai-sdk/anthropic`, `@ai-sdk/openai` and `@ai-sdk/google` from `devDependencies` in `package.json`; **keep** `ai` and `@ai-sdk/react` — they are the wire and storage contract, not providers (contracts/removals.md §3, §4)
- [ ] T004 [P] Confirm the bundle baseline before any source change by running `wc -c dist/server/index.js` and `du -sh dist/`, and correct `specs/003-langchain-content-assistant/quickstart.md` → Setup if it differs from the recorded 1,600,257 bytes / 4.5 MB
- [ ] T005 [P] Confirm no LangSmith tracing is enabled by this plugin: grep `server/src/` and `dist/` for `LANGSMITH_` and `LANGCHAIN_` and record the result against quickstart A12 (Principle I — a tracing client would ship prompts off the host)
- [ ] T005a Stand up the repository's first test runner: **jest**, chosen because it is what Strapi itself uses — verified this session in the installed packages (`@strapi/strapi` → `"test:unit": "jest"`, `@strapi/sdk-plugin` → `"test:unit": "node --experimental-vm-modules node_modules/jest/bin/jest.js"`). Add it plus a TypeScript transform to `devDependencies`, and a `test` script to `package.json`. The transform is picked and **verified against the installed toolchain in the session that adds it**, not recalled — this project is TypeScript + CommonJS, and the wrong transform is a config rabbit hole, not a compile error. **Standing rule for every suite below: no test may call a language model, open a network connection, bootstrap the Strapi runtime, or touch the filesystem outside its own fixtures.** Every suite covers a pure function whose determinism is already a stated requirement, so a failure is a real defect and never a flake

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the shared type surface and configuration normalization every story below reads. Kept in
one phase specifically so six stories do not collide on `server/src/types.ts` and
`server/src/services/config.ts`.

**⚠️ CRITICAL**: No user story work begins until this phase is complete.

- [ ] T006 Extend the shared type surface in `server/src/types.ts`: add `ProviderDescriptor` (data-model §1), widen `StudioSettings.activeProvider` from its literal union to `string`, widen `providers` to `Record<string, ProviderState>`, add `ProviderState.baseUrl: string | null`, add `StudioSettings.grounding: { enabled: boolean }`, add `MaskedProviderState.baseUrl`, add `InstructionSet`, `InstallDescription` and `PublishOutcome`, and extend `ChangeItemOutcome` with `publish?: PublishOutcome` — no `any` in any exported signature (audit-type **removals** belong to US2/T040)
- [ ] T007 Rewrite the normalization in `server/src/services/config.ts`: an extensible `providers` map that **preserves unknown keys** on read and write, `baseUrl` validation (absolute `http:`/`https:`, no userinfo component, trailing slashes trimmed), `grounding` defaulting to `{ enabled: true }`, `isSet` always recomputed from `apiKeyEnc`, a missing field always taking its default so an upgrade never breaks an existing install, and `getDecryptedKey` still decrypting **only** the requested provider (data-model §3). Also add **`isGroundingEnabled()`**, the single place the two-switch precedence of contracts/install-description.md §7 is computed — `pluginConfig.grounding.enabled && settings.grounding.enabled`. Every caller reads it; two flags with the rule re-derived per call site is how they end up disagreeing
- [ ] T008 [P] Add the `grounding` plugin-config option to `server/src/config/index.ts` — `{ enabled: true, maxChars: 24000 }`, `maxChars` clamped to `2000..80000` (contracts/install-description.md §6), with a safe default for an existing install (FR-036). This `enabled` is the **hard off-switch** set by the host app's developer at deploy time; the runtime `Toggle` in settings can only narrow it, never re-enable it (contracts/install-description.md §7)
- [ ] T009 Run `corepack pnpm@10 run typecheck` and record the failures: they must be confined to the files US1 rewrites — the `switch (activeProvider)` in `server/src/services/registry.ts` and the unguarded `MODELS[next][0].id` index in `admin/src/pages/Settings.tsx`. A failure anywhere else means the widening in T006 reached further than intended

**Checkpoint**: dependency tree resolved, type surface extended, configuration normalized — story work can begin.

---

## Phase 3: User Story 1 - Every provider the adapter layer supports is reachable (Priority: P1) 🎯 MVP

**Goal**: language-model access goes through one LangChain-backed provider layer built from a
declarative table; all four shipped providers are configurable from settings and answer live
messages; and the browser's protocol and the database's shape do not move at all.

**Independent Test**: for each of the four shipped providers in turn — including
`openai-compatible`, which the plugin never supported — send one live message that requires a tool
call and produces a change plan, and confirm streaming text, visible tool activity, the plan card,
stop, approval and the per-item report all behave as they do today.

**⚠️ The riskiest phase.** [contracts/chat-stream.md](contracts/chat-stream.md) is the checklist it
must satisfy: the streaming, tool-activity, stop and persistence contract all move at once.
Old-conversation replay is verified **here**, not later.

### Implementation for User Story 1

- [ ] T010 [P] [US1] Create the declarative provider table in `server/src/services/providers.ts`: **static** imports of `ChatAnthropic` (`@langchain/anthropic`), `ChatOpenAI` (`@langchain/openai`) and `ChatGoogleGenerativeAI` (`@langchain/google-genai`), and four `ProviderDescriptor` rows — `anthropic`, `openai`, `google`, `openai-compatible` — using the verified constructor options (`apiKey` + `model` everywhere; `configuration.baseURL` for `ChatOpenAI`, `baseUrl` for Google), `requiresBaseUrl` true **only** for `openai-compatible`, `useResponsesApi` left at its verified `false`, and a per-descriptor `supportsVision` implementing the **four declared rules** of contracts/provider-layer.md §3 — ported **verbatim** from today's `modelSupportsVision()` in `server/src/services/registry.ts` (`anthropic`: `claude-` prefix; `google`: `gemini-` prefix; `openai`: `gpt-4`/`gpt-5`/`o<digit>` minus the `gpt-3.5` and non-text exclusions; `openai-compatible`: never), default-deny for anything a rule cannot answer. **Leaving the three first-party descriptors at a bare default-deny is a silent regression** — image input works on all three today, it fails no negative test, and only quickstart A13 catches it. No dynamic `import()`, no `initChatModel`, no `switch` on provider identity (contracts/provider-layer.md §1, §3)
- [ ] T011 [P] [US1] Create the client-side provider catalog in `admin/src/data/providers.ts` — id, English label, `requiresBaseUrl`, and `hasCuratedModels` derived from `MODELS[id] != null`. A **separate module**: nothing may be appended to `admin/src/data/models.ts` or restructure its `MODELS` literal (research D15)
- [ ] T012 [US1] Rewrite `server/src/services/registry.ts`: **delete** the `switch (activeProvider)`, resolve the descriptor from the table on **every** request from persisted config, raise `NO_ACTIVE_PROVIDER` / `PROVIDER_DISABLED` / `MISSING_KEY` / `MISSING_BASE_URL` (new) / `UNKNOWN_PROVIDER` **before generation begins** with messages that name the provider and never the key, return `{ model, provider, modelId, supportsVision }` where `model` is a `BaseChatModel` instance, and replace the prefix-based `modelSupportsVision()` with the descriptor's declared rule (contracts/provider-layer.md §2)
- [ ] T013 [US1] Update `server/src/controllers/settings.ts`: `GET` returns the masked shape including `grounding` and `baseUrl` **in full** (it is configuration, not a secret); `PUT` zod-validates `activeProvider` against the table (`400 unknown_provider` naming it), stores `activeModel` **verbatim** with no validation against any curated list and no normalization, keeps `apiKey` write-only (absent keeps the stored key, explicit `null` clears it, never echoed), validates `baseUrl` with a `400` naming the field, rejects an unknown provider key on write, and responds with the same masked shape so the client rehydrates from the server (contracts/provider-layer.md §4)
- [ ] T014 [US1] Update `admin/src/pages/Settings.tsx`: provider `SingleSelect` sourced from `admin/src/data/providers.ts`; a curated `SingleSelect` when `MODELS[providerId]` exists and a plain text input when it does not; **remove the unguarded `MODELS[next][0].id` index**, which throws for a provider with no curated list; a Base URL input in its **own labelled field**, visibly separate from the credential and marked required for `requiresBaseUrl` providers — never a placeholder or hint on the key field; and an English note beside the model input when the provider has no curated list (contracts/provider-layer.md §5)
- [ ] T014a [US1] Two pure-function suites, no Strapi runtime and no provider. **(a)** `supportsVision` from `server/src/services/providers.ts`: a table of `(descriptor id, model identifier) -> expected`, asserting each of the four declared rules of contracts/provider-layer.md §3 — every `true` case, every exclusion (`gpt-3.5`, the non-text families), and `openai-compatible` returning `false` for everything. This is the suite that makes finding U1 impossible to reintroduce: a descriptor silently reverted to bare default-deny turns the table red instead of passing every negative check. **(b)** `server/src/services/config.ts`: normalization keeps unknown provider keys, `isSet` is recomputed from the ciphertext and never trusted from input, a missing field takes its default, `baseUrl` validation accepts absolute `http:`/`https:` and rejects relative URLs and a userinfo component while trimming trailing slashes, and `isGroundingEnabled()` returns the AND of both switches across all four combinations (FR-006, FR-008, FR-036)
- [ ] T015 [US1] Create `server/src/services/agent.ts` — build the per-request `createAgent({ llm, tools, prompt })` from `langchain` and run it as `agent.stream(state, { signal, recursionLimit: 17 })`. The `17` is `2 × 8 + 1`: `recursionLimit` counts LangGraph **super-steps**, not model calls, so preserving today's ceiling of 8 model steps means a model node plus a tool node per iteration plus the terminal model node (contracts/chat-stream.md §5). LangChain's `tool-approval-request` / `tool-approval-response` human-in-the-loop mechanism is **deliberately unused** — approval stays structural
- [ ] T016 [US1] Register the new `agent` service in `server/src/services/index.ts`
- [ ] T017 [US1] Rewrite `server/src/services/tools.ts` onto LangChain's `tool(fn, { name, description, schema })`, porting each tool **shape-for-shape**: the existing zod v4 schemas, the uid allow-list, the `permission-checker` check against the **caller's live** ability, the compact JSON result and the structured errors, all rebuilt per request (research D7, Principle II). The `mode` parameter and its gating stay for now — US2/T038 removes them, which is what keeps this story independently shippable
- [ ] T018 [US1] Rewrite the request path in `server/src/controllers/chat.ts`: `toBaseMessages(replayed)` directly on the `UIMessage[]` the history rebuild already produces (**not** via `convertToModelMessages`), the agent stream from T015, then `toUIMessageStream(agentStream).tee()` with the client branch handed to `pipeUIMessageStreamToResponse({ response: ctx.res, stream: toClient, headers })`. The route path, its policies, `useChat`, `DefaultChatTransport` and the wire protocol are **unchanged** — if the client needs a change, the contract is broken (contracts/chat-stream.md §1, §2)
- [ ] T019 [US1] Rebuild persistence in `server/src/controllers/chat.ts` on the second tee branch: consume it with `readUIMessageStream({ stream: toStore })` keeping the last yielded message, whose `parts` are what `chat-message.parts` stores. **Drain it unconditionally** — success, provider error and abort — because an unread `tee` branch applies backpressure and stalls the response. A persistence failure logs through `redact.describeError` and **never** surfaces as a provider error; the user's turn is still persisted before streaming begins; file parts are filtered out so stored history never holds attachment bytes (contracts/chat-stream.md §3)
- [ ] T020 [US1] Rewire stop in `server/src/controllers/chat.ts`: keep the Koa `close` / `aborted` distinction (a close before the stream finished is a real stop; after normal completion it is not), pass `abort.signal` into `agent.stream`, keep the partial output marked interrupted, append the `data-interrupted` part carrying `appliedSince({ threadId, ownerId, since })` so a plan approved **while the turn was still streaming** is still reported, leave the thread usable, and begin no further tool step after abort (contracts/chat-stream.md §4)
- [ ] T021 [US1] In `server/src/controllers/chat.ts`, drop image bytes from the outgoing message **before** `toBaseMessages` converts anything whenever `supportsVision` is `false`, while keeping the ordinal attachment manifest reaching the model as text so placement by filename still works (FR-006, FR-023)
- [ ] T022 [US1] Error handling in `server/src/controllers/chat.ts`: all five `ProviderConfigError` codes answered as ordinary HTTP errors naming the provider **before** generation; provider errors during the stream logged through `redact.describeError` and surfaced generically unless `showProviderErrorDetails` is on, in which case the **redacted** detail is shown. Nothing credential-shaped is echoed on any path (contracts/chat-stream.md §8, SC-009)
- [ ] T023 [US1] Write the US1 `README.md` delta: the shipped provider table, how a provider is configured, the base-URL field, and that a provider the adapter layer supports but the distribution does not carry is **absent from the selection rather than offered and broken** (FR-011, FR-053)
- [ ] T024 [US1] Verify quickstart scenarios A1-A14 in a running admin panel per `specs/003-langchain-content-assistant/quickstart.md` §A — one live send per shipped provider, provider switch under a minute with no restart, stop mid-turn, the direct-identifier round trip, a non-curated identifier still used verbatim, missing credential and missing base URL both refused before generation, an invalid base URL `400`, image **withheld** on a non-vision model (A10) **and image input still working on a vision-capable one (A13 — run the pair; a bare default-deny passes A10 and removes the capability silently)**, a redacted provider error, and the A14 credential sweep. A provider that has not answered a real message has not been verified
- [ ] T025 [US1] Verify quickstart G1-G3 per `specs/003-langchain-content-assistant/quickstart.md` §G: diff a turn stored **after** this change against one stored **before** it (same part types, same field names, same nesting — this is the check that makes FR-013 true rather than hoped for), confirm the client was not modified for the provider swap beyond the `mode` body field, and confirm a turn needing several discovery calls completes so `recursionLimit` did not silently tighten the ceiling
- [ ] T026 [US1] Run the per-commit gate for this phase: `corepack pnpm@10 run typecheck` clean, `corepack pnpm@10 run build` with `dist/` staged, and Principles I and II re-checked for the changes under `server/src/services/`

**Checkpoint**: all four providers configurable and answering live, with the wire format and the stored shape provably unmoved.

---

## Phase 4: User Story 2 - One mode, and no mode selector (Priority: P1)

**Goal**: no mode control exists anywhere in the interface, every conversation is content editing,
the QA/security audit capability is retired outright with no unreachable remnant, and conversations
stored before this change still open, replay and continue.

**Independent Test**: open the chat panel and confirm no mode control exists anywhere on it; then
open a conversation created before this change — ideally one recorded under Layout Mapping or Code
Audit — and confirm it opens, replays its full history, and accepts a new message.

### Implementation for User Story 2

- [ ] T027 [P] [US2] Delete `admin/src/components/ModeSelect.tsx`
- [ ] T028 [P] [US2] Delete `admin/src/components/AuditReportCard.tsx`
- [ ] T029 [P] [US2] Delete `server/src/services/audit-qa.ts` and `server/src/services/audit-security.ts`
- [ ] T030 [P] [US2] Delete `server/src/policies/has-audit-permission.ts` (already unreferenced by any route — dead on arrival)
- [ ] T031 [US2] Remove `mode`, `setMode`, `modeRef` and `changeMode` from `admin/src/hooks/useThreads.ts`
- [ ] T032 [US2] Remove the mode wiring from `admin/src/pages/Chat.tsx`: the `mode` field leaves the chat transport body and the mode-conditional composer hint goes
- [ ] T033 [P] [US2] Make the composer hint in `admin/src/components/Composer.tsx` always speak about approval, never about which mode is active (FR-017)
- [ ] T034 [P] [US2] Remove the mode control from the header prop in `admin/src/components/ThreadSidebar.tsx`
- [ ] T035 [US2] Delete the audit-report branch from `admin/src/components/MessageList.tsx`, so a stored `runQaScan` / `runSecurityAudit` part falls through to the generic tool pill — it reads as something that happened, **without implying the capability is still available** (contracts/removals.md §2)
- [ ] T036 [US2] Stop resolving `mode` in `server/src/services/threads.ts`, and drop `setMode` and the `modeAtSend` passing
- [ ] T037 [US2] Drop `mode` from the chat request schema in `server/src/controllers/chat.ts` and from its calls into `prompt.build` and `tools.buildTools`
- [ ] T038 [US2] In `server/src/services/tools.ts`: remove the `mode` parameter of `buildTools`, delete the `runQaScan` and `runSecurityAudit` tools, and make `describePageStructure` **unconditional** — it was gated to `layout` and `audit`, and FR-014 requires structure discovery in the only mode there is. The tool set becomes exactly `listContentTypes`, `searchEntries`, `getEntry`, `describePageStructure`, `proposeChanges` (contracts/removals.md §1)
- [ ] T039 [US2] In `server/src/services/prompt.ts`: delete `MODE_SECTION`, `CONTENT_MODE`, `LAYOUT_MODE` and `AUDIT_MODE` **outright** — not folded into a single "mode" heading — and add the retirement guidance stating that the QA scan and the security audit are no longer offered, so a request for either is answered plainly and no substitute is improvised (FR-016, US2-5). US3/T050 absorbs this as the declared `retired` section
- [ ] T040 [US2] Remove from `server/src/types.ts`: `CHAT_MODES`, `ChatMode`, and `AuditKind`, `AuditSeverity`, `AuditCategory`, `AuditLocation`, `AuditFinding`, `AuditCoverage`, `AuditReport`, `AuditOptions` (data-model §8)
- [ ] T041 [US2] Remove the `'audit-qa'` and `'audit-security'` service registrations from `server/src/services/index.ts` — a dead service that still registers is a remnant
- [ ] T042 [US2] Remove the `'has-audit-permission'` policy registration from `server/src/policies/index.ts`
- [ ] T043 [US2] Remove the `audit` config key from `server/src/config/index.ts` and `getAuditOptions()` from `server/src/services/config.ts`
- [ ] T044 [US2] Unregister the `plugin::ai-content-studio.audit.run` permission action in `server/src/bootstrap.ts`. A role that was granted it must not break the upgrade — a stored grant for a no-longer-registered action is inert, so there is nothing to migrate
- [ ] T045 [P] [US2] Mark the columns vestigial in their `description` fields — `mode` in `server/src/content-types/chat-thread/schema.json` and `modeAtSend` in `server/src/content-types/chat-message/schema.json` — and **do not remove them**: they are `required` enumerations on live consumer databases, so removal is a migration risk for no behavioural gain (research D12, contracts/removals.md §3)
- [ ] T046 [US2] Remnant sweep: grep `admin/src/`, `server/src/` and the built `dist/` for the removed services, policy, component, tools, types, config key and permission action, and for user-visible text referring to modes — read the built strings rather than only grepping for the word "mode", because a paraphrase survives a grep (FR-016, FR-017)
- [ ] T047 [US2] Add the breaking-change table to `README.md` (FR-054), naming the version that removes each item and what a consumer who granted it should do: `plugin::ai-content-studio.audit.run` unregistered (nothing required, the grant is inert — remove it from any role for tidiness), the QA scan and security audit capabilities gone with no planned replacement, the Layout Mapping and Code Audit modes gone (existing conversations open and continue as content editing), and the `audit` plugin config key now ignored (remove it from `config/plugins.ts`)
- [ ] T048 [US2] Verify quickstart scenarios B1-B8 per `specs/003-langchain-content-assistant/quickstart.md` §B — no mode control anywhere, no selection step on a new conversation, a pre-change conversation recorded under a removed mode replaying in full and accepting a follow-up, a stored audit tool part rendering as a generic pill, structure questions answered with no mode switch, a QA-scan request answered as retired, the remnant search clean, and an install that had granted `audit.run` upgrading without failure
- [ ] T049 [US2] Run the per-commit gate for this phase: typecheck clean, `dist/` rebuilt and staged, the README delta from T047 in the same commit, and Principles I and II re-checked

**Checkpoint**: one mode, no selector, the audit capability retired with the removal spoken rather than silent, and pre-change conversations intact.

---

## Phase 5: User Story 3 - A detailed, versioned set of instructions (Priority: P2)

**Goal**: the instructions become explicit, sectioned in a fixed declared order, byte-for-byte
identical for identical inputs, and carry a version derived from their own text so an edit cannot
ship without changing it — recorded against every stored assistant turn.

**Independent Test**: capture the composed instructions for a fixed set of request inputs twice and
confirm they are identical; read them end to end and confirm they name no consuming project and
hard-code no field names; then run the scripted prompts (an ambiguous target, a denied permission, a
request that needs no change) and confirm each is handled the way the instructions say.

### Implementation for User Story 3

- [ ] T050 [US3] Rewrite `server/src/services/prompt.ts` to compose from declared sections in the fixed order of [contracts/instructions.md](contracts/instructions.md) §1 — `role`, `discovery`, `permissions`, `ambiguity`, `proposing`, `tool-honesty`, `retired`, `style` always present; `attachments` and `attachments-blind` only when the turn carries held files and the model is not vision-capable; `install` and `condensed` conditional — separated by a blank line, with the prohibitions of §5 honoured: no consuming project name, no hard-coded field name or content-type identifier or page structure, English only, no model identifier, no claim that the assistant can approve/apply/preview/publish, and no reference to modes
- [ ] T051 [US3] Derive the version in `server/src/services/prompt.ts` as `` `v1-${sha256(sections 1..8, joined in order).slice(0, 8)}` `` using `node:crypto` at module load (no new dependency), and return an `InstructionSet` of `{ version, text, sections, groundingIncluded, groundingPartial }`. The install description is **excluded** from the hash: the version answers "which rules was this turn run under", and folding per-install fact into it would make the version churn per install and identify nothing (research D10)
- [ ] T052 [US3] Make `prompt.build` a pure function of exactly `{ supportsVision, hasAttachments, groundingEnabled, readableUids (sorted before use), schemaFingerprint, contextSummary }` in `server/src/services/prompt.ts`, with `Date`, `Math.random`, any counter, any read of entry data, any provider call and any locale-dependent formatting forbidden inside the composer (FR-018, contracts/instructions.md §4)
- [ ] T052a [US3] Suite over `prompt.build` in `server/src/services/prompt.ts` — a pure function by contract, so this is a test of the requirement itself, not of a model. Assert: composing **ten** times from one fixed input set yields ten byte-identical strings (FR-018, SC-004 — the check quickstart C1 asks a human to perform ten times, which no human will); the declared section order of contracts/instructions.md §1 holds, and the conditional sections appear only under their stated conditions; the prohibitions of §5 hold across every input combination (no model identifier, no hard-coded content-type identifier or field name, no reference to modes, no claim the assistant can approve/apply/preview/publish); and two different section texts derive two different `version` values, so FR-026 is structural rather than remembered. **Not** a snapshot of the prompt text — a snapshot would turn every legitimate edit red and train everyone to update it blindly
- [ ] T053 [P] [US3] Add `promptVersion` (string, **nullable**) to `server/src/content-types/chat-message/schema.json` — nullable because turns stored before this change honestly have none, and a null is honest where a backfilled guess would not be (data-model §6)
- [ ] T054 [US3] Record `promptVersion` on the stored assistant turn in `server/src/services/threads.ts` (FR-019)
- [ ] T055 [US3] Pass `InstructionSet.version` from the composed instructions into the persistence path in `server/src/controllers/chat.ts`
- [ ] T056 [US3] Verify quickstart scenarios C1-C10 per `specs/003-langchain-content-assistant/quickstart.md` §C — compose for a fixed input set **ten** consecutive times and compare byte-for-byte (SC-004), read the composed text **end to end** rather than grepping it, then the permission-denial, ambiguity, "nothing has changed yet", no-change-needed, one-plan and tool-honesty prompts; C9 edits one character of the instruction text and confirms `promptVersion` changed with no version constant touched; C10 confirms a pre-change turn's `promptVersion` is `null`
- [ ] T057 [US3] Run the per-commit gate for this phase: typecheck clean, `dist/` rebuilt and staged, Principles I and II re-checked

**Checkpoint**: instructions explicit, deterministic, and traceable to the rules in force.

---

## Phase 6: User Story 4 - The prompt knows this project's structure (Priority: P2)

**Goal**: a deterministic, permission-scoped, size-bounded description of the running install's
schema is embedded as a subordinate section of the instructions, recomputed when the schema changes
with no restart, switchable off, and inspectable from settings as the exact text requests carry.

**Independent Test**: on one install, send the same request twice and confirm the embedded
description is identical; add a content type and confirm the next request reflects it with no
restart; sign in as an account without read access to a content type and confirm that type is absent
from the description; open the settings inspector and confirm it shows exactly the text that was sent.

### Implementation for User Story 4

- [ ] T058 [US4] Create `server/src/services/grounding.ts` deriving the description from **only** `strapi.contentTypes` (keys prefixed `api::`), `strapi.components`, the plugin's own `getPreviewOptions().paths`, and the caller's live `permission-checker` `can.read()`. Render the fixed section order of [contracts/install-description.md](contracts/install-description.md) §2 — content types (uid, display name, kind, draft & publish, localized, preview target, fields with type/required/enum/relation target and cardinality/component reference and repeatability, then the dotted **media field** paths), components, preview targets — sorting every list lexicographically by a fixed byte ordering (never `localeCompare`) while keeping enum values in their declared schema order. **Forbidden inputs**: the host application's source code (FR-028), the Document Service and any entry or count, media URLs or user data, a language model, and wall-clock time
- [ ] T059 [US4] Add the fingerprints and cache to `server/src/services/grounding.ts`: `schemaFingerprint` (sha256 over the canonically serialized `api::*` schemas plus components) and `readableFingerprint` (sha256 over the caller's **sorted** readable-uid list), keyed as the pair so a cache hit is provably the right text. **No TTL** — a TTL would make the description a function of *when* you asked, which is precisely the non-determinism FR-030 exists to prevent. A new content type changes the schema fingerprint, so the next request reflects it with no restart (FR-033)
- [ ] T060 [US4] Add the size budget and tiered degradation to `server/src/services/grounding.ts`: `full` → `no-components` (component section dropped, references named but not expanded) → `names-only`, and if `names-only` still exceeds the budget, drop content types from the **end of the sorted order** and state the count dropped. Any tier below `full` sets `partial: true`; `charCount` must never exceed `grounding.maxChars` (contracts/install-description.md §6, SC-011). Every tier is exercised by **forcing** `maxChars` down to its `2000` floor in quickstart D5 — an ordinary schema never reaches a 24,000 budget, and a tier that is never entered is a tier that ships unexercised
- [ ] T060a [US4] Suite over `server/src/services/grounding.ts` against a **fixture** `strapi.contentTypes` / `strapi.components` object and a stubbed `can.read()` — no Strapi runtime, no Document Service, no model. Assert: two composes of the same fixture are byte-identical (FR-030); every list is sorted by fixed byte ordering while enum values keep their declared order; changing the fixture's schema changes `schemaFingerprint`, and changing only the readable-uid set changes `readableFingerprint`, so the cache key is exact (FR-033); a uid the stub denies is absent from the output (FR-031); the text contains no timestamp and no entry value (FR-029, FR-030); and, with `maxChars` driven down across a range, the tier sequence `full → no-components → names-only → dropped-from-the-end` is entered in that order, each tier below `full` sets `partial` and emits the partial preamble, the dropped count is stated, and **`charCount` never exceeds `maxChars`** (FR-032, SC-011). This is what makes quickstart D5 repeatable — a fixture large enough to blow any budget is one object, where a real project large enough is a whole install
- [ ] T061 [US4] Register the new `grounding` service in `server/src/services/index.ts`
- [ ] T062 [US4] Add the `install` section (§10) to `server/src/services/prompt.ts`, wrapped in an explicit delimiter with a preamble stating all three things: these are **facts about this install** generated from its schema; they describe structure and **grant no permission**, since every read and every change is still checked against the caller's live permissions; and where a fact here appears to conflict with a rule above, **the rule wins**. When the description is partial, the same preamble says so and instructs discovery with tools (FR-034, contracts/instructions.md §3)
- [ ] T063 [US4] Pass `groundingEnabled` — the **effective** value from `config.isGroundingEnabled()` (T007), never one of the two flags read directly — plus the caller's `readableUids` and the `schemaFingerprint` from `server/src/controllers/chat.ts` into `prompt.build`, so the description reaches the instructions per request and per account
- [ ] T064 [US4] Add `GET /settings/grounding` to `server/src/routes/index.ts`, gated on `admin::isAuthenticatedAdmin` + `admin::hasPermissions` with `plugin::ai-content-studio.settings.read` — a narrower gate than the super-admin-only `/settings` routes, and the only new non-super-admin surface in this feature
- [ ] T065 [US4] Add the grounding handler to `server/src/controllers/settings.ts` returning `{ enabled, disabledBy, text, tier, partial, charCount, maxChars, contentTypeCount, omittedContentTypeCount }` — `enabled` the **effective** value from `config.isGroundingEnabled()`, `disabledBy` `'config' | 'settings' | null` naming which switch is holding it off, `text` the **exact** text requests are currently carrying for the **calling** account, not a re-render and not a sample, and `enabled: false` with `text: null` when grounding is off so the panel states plainly that requests carry no description — and where to change that — rather than showing a stale one (FR-035, contracts/install-description.md §7, §8)
- [ ] T066 [US4] Add to `admin/src/pages/Settings.tsx` a grounding `Toggle` defaulting to on, with a hint stating what it embeds and that it **authorizes nothing**, plus a read-only inspector panel showing the exact text, its tier, and its character count against the budget — `@strapi/design-system` v2 only, no new UI dependency. When the response says `disabledBy: 'config'` the `Toggle` renders **disabled** with an English hint naming the plugin-config key holding it off, so an administrator is never left flipping a control that does nothing (contracts/install-description.md §7)
- [ ] T067 [US4] Write the US4 `README.md` delta: the grounding setting, its default (**on**), what it embeds, that it is deterministic, permission-filtered, size-bounded and inspectable, and that it authorizes nothing — plus **both switches and their precedence**: the `grounding.enabled` plugin-config key is the deploy-time hard off-switch, the settings `Toggle` is the runtime one, and the description is embedded only when both are on (FR-053, contracts/install-description.md §7)
- [ ] T068 [US4] Verify quickstart scenarios D1-D12 per `specs/003-langchain-content-assistant/quickstart.md` §D — real field names with none invented, two identical requests producing an identical description, a new content type reflected with no restart, a content type absent for an account that cannot read it, **deterministic shortening verified at the forced `maxChars` floor** so every tier and the drop-from-the-end path is actually entered (D5 — restore the default before D12), no entry values or media URLs or secrets, grounding off **by each switch in turn** falling back to tool discovery with nothing else changed, the inspector matching what was sent, a described-but-not-updatable type still coming back blocked with a reason, a mid-conversation schema change, the **ten-question structural probe** (SC-005: zero invented field names; SC-006: at least eight of ten answered without the editor supplying a uid), and a **thirty-turn** conversation completing (SC-011)
- [ ] T069 [US4] Run the per-commit gate for this phase: typecheck clean, `dist/` rebuilt and staged, the T067 README delta in the same commit, and Principles I and II re-checked — this phase adds a route and a permission-scoped read surface, so the re-check is not a formality

**Checkpoint**: the assistant stops guessing at field names, deterministically and within budget, without authorizing anything.

---

## Phase 7: User Story 5 - Copy what the assistant wrote (Priority: P3)

**Goal**: an editor copies an assistant reply — the whole message or a single code block — in one
action and gets clean Markdown, with a visible confirmation on success and an explicit message on
failure, working identically on a restored conversation.

**Independent Test**: send a message that returns formatted text including a list and a code block;
copy the message and confirm the pasted result is the Markdown source; copy the code block and
confirm only its contents arrive; reload the panel, reopen the thread, and confirm copying still
works on the restored messages.

### Implementation for User Story 5

- [ ] T070 [P] [US5] Create `admin/src/hooks/useCopy.ts`: attempt `navigator.clipboard.writeText`; on absence or rejection fall back to a hidden textarea plus `document.execCommand('copy')`; if that also fails, report an **explicit** failure rather than a silent no-op. The fallback is load-bearing because `navigator.clipboard` requires a secure context and a Strapi admin panel served over plain HTTP on a LAN host is not one (research D13, FR-040)
- [ ] T071 [US5] Create `admin/src/components/CopyButton.tsx` — a real focusable `button` with an English `aria-label`, operable without a pointer, its outcome announced via `role="status"`, built from `@strapi/design-system` v2 and `@strapi/icons` v2 only (FR-041)
- [ ] T072 [US5] Add the copy-control styles to `admin/src/components/styles.ts`
- [ ] T073 [US5] Wire the controls into `admin/src/components/MessageList.tsx`: one per assistant message copying that message's **Markdown source** (the `text` parts joined, which is the source as authored), one per code block copying **only** that block's contents without surrounding prose, **no control at all** on a message that is only a structured card unless a readable plain-text rendering of the card is offered — never a control that copies nothing — and either no control while a turn is still streaming or one that copies exactly what has arrived, never a partial value presented as complete (FR-038, FR-039, FR-043)
- [ ] T074 [US5] Verify quickstart scenarios E1-E7 per `specs/003-langchain-content-assistant/quickstart.md` §E — Markdown source with a visible confirmation, a code block copied alone, the structured-card rule, an unavailable clipboard falling back and then failing out loud, keyboard-only and screen-reader operation, a restored reply behaving identically, and a still-streaming reply
- [ ] T075 [US5] Run the per-commit gate for this phase: typecheck clean, `dist/` rebuilt and staged

**Checkpoint**: assistant output travels out of the panel without losing its formatting.

---

## Phase 8: User Story 6 - Approve and publish in one deliberate, clearly risky action (Priority: P3)

**Goal**: the plan card offers a visually distinct, risk-labelled action that applies the approved
items and publishes each affected document behind an explicit confirmation, with every publish
permission-checked per document at the moment of application and a per-item report that persists
into the transcript.

**Independent Test**: with a plan holding two field changes on a draft-and-publish type, use the
risky action; confirm the confirmation is required, both fields are written, the document is
published, and the report says which items were published. Repeat as an account without publish
permission on the target and confirm the publish is reported blocked with a reason while the field
write still applies.

**Note**: `POST /ai-content-studio/change-sets/:id/apply` remains the **only** path in this plugin
that mutates content, and it remains plain deterministic server code reached from the editor's
click. The model is not involved in it. Publish is a second phase of that same call and **cannot be
reached independently** (research D14).

### Implementation for User Story 6

- [ ] T076 [P] [US6] Add `publishRequested` and `publishConfirmed` (booleans) to `server/src/content-types/change-set/schema.json` (data-model §7)
- [ ] T077 [US6] Add gate step 3 to the apply path in `server/src/services/change-sets.ts`: `publish: true` requires `confirmPublish: true`, refused **at the top of the gate before any write** with `409 publish_confirmation_required`, so a single activation writes nothing and publishes nothing — otherwise "activate once, then navigate away" would leave content changed (FR-045, US6-7). The existing six steps keep their order and their all-or-nothing versus per-item semantics
- [ ] T078 [US6] Add the publish phase to `server/src/services/change-sets.ts`, running only when `publish === true`, **after every write completes** so a document is never published against a half-written draft. It operates on **distinct documents**, not items: targets are the distinct `(contentTypeUid, documentId)` pairs of items whose write outcome is `applied`, excluding items whose operation was already `publish`. Per target — no draft & publish → `not_applicable` ("live on save", no publish attempted); `can(uid, 'publish', ability)` false → `blocked` with the permission reason; else publish → `published`, or `failed` with the host's reason. `publish` is a **separate action** from the `update` already checked and is never inherited from it. Each target's result is attributed to **every contributing item** as `outcome.publish`, so one document is published once but reported per item; items whose write did not reach `applied` get `{ state: 'skipped' }` (FR-046..FR-050, Principle II)
- [ ] T079 [US6] Derive the set status in `server/src/services/change-sets.ts`: `applied` **only** when every selected item's write reached `applied` **and** every publish outcome is `published` or `not_applicable`; anything else — a blocked publish included — is `partially_applied`, reported as partially applied and never as a success (FR-052). Any transition out of `pending` still revokes the set's previews
- [ ] T080 [US6] Accept `publish` and `confirmPublish` in the apply body in `server/src/controllers/change-sets.ts` with zod validation, returning `409 publish_confirmation_required` for the mismatch and leaving every existing error code and status unchanged, so the risky action on an expired or already-resolved plan is refused with the **same** explanation as the existing approve actions
- [ ] T081 [US6] Add `publish` and `confirmPublish` to the apply call in `admin/src/hooks/useChangeSet.ts`
- [ ] T082 [US6] Add the **Approve & Publish (Risky)** action to `admin/src/components/ChangePlanCard.tsx` — a danger variant, visually distinct and never styled as the safe default, requiring a confirmation whose text states **both** consequences: that publishing makes the content publicly visible immediately, and that it publishes each affected document's **entire current draft** — not only the fields this plan reviewed — so any unreviewed draft edit already sitting on those documents goes live with it, plus the count of documents to publish. The second paragraph is not optional: document-scoped publication is the one consequence invisible in the plan's own before/after rows. Approve all / Approve selected / Reject / Select all stay **unchanged in behaviour and appearance**, the separate destructive confirmation is still additionally required, dismissing or navigating away applies and publishes nothing, and the action is disabled under the same conditions as the existing ones (FR-044, FR-045, FR-048, FR-051)
- [ ] T083 [US6] Add the risky-action styles to `admin/src/components/styles.ts` — **the same file as T072**, so US5 and US6 must not be edited concurrently in that file
- [ ] T084 [US6] Render the publish outcome per row in the apply report in `admin/src/components/MessageList.tsx`: what was written and, when the publish phase ran, whether the document was published, with the reason whenever either was refused. The report is appended to the conversation and persisted on the thread so a reload replays it rather than losing it to a toast (FR-050, US6-8)
- [ ] T085 [US6] Write the US6 `README.md` delta: the new approval action, what its confirmation means, and that the existing approve actions are unchanged (FR-053)
- [ ] T086 [US6] Verify quickstart scenarios F1-F14 per `specs/003-langchain-content-assistant/quickstart.md` §F — a two-field plan published with a per-item report, an account without publish permission reported blocked with the reason while the write still applies, the destructive confirmation still separately required, a non-draft-and-publish target reported live on save, a conflicting item neither applied nor published, the existing actions behaving exactly as before, activate-without-confirming leaving nothing applied, the report replaying after a reload, the confirmation text stating both consequences, a host-refused publish reported failed with its reason alongside an accurate write outcome, an expired and an already-applied plan refused identically, two editors racing one plan, the SC-010 count, and SC-008's at-most-two deliberate actions
- [ ] T087 [US6] Run the per-commit gate for this phase: typecheck clean, `dist/` rebuilt and staged, the T085 README delta in the same commit, and Principles I and II re-checked — this phase adds a write surface, so the per-document publish check is the re-check's subject

**Checkpoint**: all six stories independently functional; an editor can take a reviewed plan live in two deliberate actions, one of them a confirmation.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T088 Reconcile the whole of `README.md` in one `docs:` pass (plan Implementation Order item 10): providers and how one is configured, the removed modes and capabilities, the grounding setting and its default, the new approval action, and every breaking change with its version — the per-phase deltas landed with their commits; this pass makes the page coherent (FR-053, FR-054)
- [ ] T089 [P] Update `CLAUDE.md` so the `server/src/services/registry.ts` description names the LangChain path and the per-descriptor `supportsVision` rule instead of the removed prefix-based `modelSupportsVision()`, keeping the image-input rule's instruction accurate for the next session
- [ ] T090 [P] Record the bundle size after the change — `wc -c dist/server/index.js` and `du -sh dist/` — against the T004 baseline in `specs/003-langchain-content-assistant/quickstart.md`, and state the delta in the commit body. **No threshold gates this**: the growth is accepted as the price of the provider layer on the maintainer's decision, because a git dependency is fetched once and then cached. Recording it keeps the cost known rather than discovered later (plan → Risks, research D8)
- [ ] T091 [P] Verify quickstart G4 per `specs/003-langchain-content-assistant/quickstart.md` §G: grep the built output for non-English strings — zero (FR-025, SC-012)
- [ ] T092 Run the full SC-009 credential sweep per `specs/003-langchain-content-assistant/quickstart.md` A14 — across every shipped provider, every error path, the grounding inspector and the server logs: **zero** occurrences of credential material. T024's run of it is a spot check on the provider surface alone; this is the authoritative one, over the whole shipped feature, and it is not skipped as already done anywhere
- [ ] T093 Confirm all twelve success criteria SC-001..SC-012 listed in `specs/003-langchain-content-assistant/spec.md` against the observations recorded in T024, T048, T056, T068, T074 and T086, and note any that were not observed in a running admin panel rather than reported as met
- [ ] T094 Verify quickstart G5-G6: `corepack pnpm@10 run typecheck` clean, and `dist/` staged with every source commit in this feature — no stale `dist/`
- [ ] T095 Walk `specs/003-langchain-content-assistant/quickstart.md` → Definition of done and confirm each line, including that the T001 constitution amendment landed **first** in its own `docs:` commit with an updated Sync Impact Report
- [ ] T096 Re-read the composed instruction text end to end one final time against [contracts/instructions.md](contracts/instructions.md) §5, because a prohibition checked only by grep survives a paraphrase — no consuming project name, no hard-coded field names, no model identifier, no mode reference, English throughout

---

## Dependencies & Execution Order

### Commit mapping

The constitution's per-commit gate applies to a **commit**, and its "one task per commit" rule takes
*task* to mean one unit of shippable work carrying a conventional subject — the nine commits below.
A `T` number is a step inside one of them, not a commit boundary. Several of the steps cannot stand
alone: T003 removes the packages that T012 stops importing, so committing it by itself leaves the
build broken, and T009 exists precisely to record that intermediate state before T012 and T014 clear
it. One commit, one gate run, one conventional subject.

| # | Subject | Tasks | Gate notes |
|---|---|---|---|
| 1 | `docs:` amend the constitution | T001 | Own commit, **first**, before everything. No source, no `dist/` |
| 2 | `feat:` provider adapter table + settings surface | T002-T005a, T006-T014, T014a, T023 | Typecheck is clean only at the **end** of this commit — T009's recorded failures are exactly what T012 and T014 fix, so Phases 1 and 2 are never committed on their own. Carries the test runner (T005a) and the first two suites (T014a). Gate items 1, 2, 3, 5 and 6 run here; item 4 (live sends) is deferred to commit 3, per plan → Implementation Order |
| 3 | `feat:` chat request path through the agent | T015-T022, T024-T026 | Carries commit 2's live verification as well: quickstart §A (A1-A14) and §G1-G3 |
| 4 | `feat:` one mode, audit capability retired | T027-T049 | Plan items 4 **and** 5 together: T038 removes the `mode` parameter and deletes the two audit tools in the same function, and one §B pass verifies both halves |
| 5 | `feat:` versioned, deterministic instructions | T050-T052a, T053-T057 | §C, plus the determinism suite that takes C1's ten repetitions off a human |
| 6 | `feat:` prompt grounded in the running install | T058-T060a, T061-T069 | §D. Adds a route and a permission-scoped read surface — the Principle I/II re-check is not a formality. The tier suite is what makes D5 repeatable |
| 7 | `feat:` copyable assistant output | T070-T075 | §E |
| 8 | `feat:` approve and publish in one deliberate action | T076-T087 | §F. Adds a write surface; the per-document publish check is the re-check's subject |
| 9 | `docs:` reconcile the README, close the pass | T088-T096 | §G, the SC-009 sweep, and the twelve success criteria |

Commits 1-4 are strictly ordered. Commit 6 follows 5 (the install description is a section of the
instructions commit 5 composes). Commits 7 and 8 are independent of 5 and 6 and of each other, apart
from the two admin files they share — see Parallel Opportunities. Commit 9 is last.

### Phase Dependencies

- **Setup (Phase 1)**: T001 blocks **everything** — no commit may be made against a constitution it violates. T002 blocks T003 (same file) and every server task.
- **Foundational (Phase 2)**: depends on Setup. **Blocks all six user stories** — T006's type surface and T007's normalization are read by every phase below.
- **US1 (Phase 3)**: depends on Foundational. No dependency on any other story.
- **US2 (Phase 4)**: depends on Foundational. T037-T039 edit files US1 rewrote (`chat.ts`, `tools.ts`, `prompt.ts`), so **run Phase 4 after Phase 3** rather than concurrently — this is a file-level ordering, not a capability dependency.
- **US3 (Phase 5)**: depends on Foundational; sequence after US2, which deletes the mode sections T050 replaces.
- **US4 (Phase 6)**: depends on US3 — T062 adds a section to the composer T050 builds.
- **US5 (Phase 7)**: depends on Foundational only. Genuinely independent of US1-US4.
- **US6 (Phase 8)**: depends on Foundational only. Independent of US1-US4; shares `styles.ts` and `MessageList.tsx` with US5.
- **Polish (Phase 9)**: depends on every story that is being shipped.

### User Story Dependencies

| Story | Priority | Depends on | Why |
|---|---|---|---|
| US1 | P1 | Foundational | The provider layer and the chat request path — plan items 2 and 3, one capability split across two commits only because the second is large |
| US2 | P1 | Foundational (+ US1 by file overlap) | Removing the selector is what makes one well-tested instruction set possible |
| US3 | P2 | US2 | One mode means one set of instructions to get right |
| US4 | P2 | US3 | The description is a section of the composed instructions |
| US5 | P3 | Foundational | Self-contained; independent of everything else here |
| US6 | P3 | Foundational | Builds on the existing approval and reporting flow, which US1-US4 do not change |

### Within Each User Story

- Types and configuration (Foundational) before services
- Services before controllers before routes
- Server before the admin surface that calls it
- Implementation before its verification task, and verification before the phase's gate

### Parallel Opportunities

- **Phase 1**: T004 and T005 in parallel, after T002/T003.
- **Phase 2**: T008 in parallel with T006/T007.
- **Phase 3 (US1)**: T010 and T011 in parallel (server table and client catalog, different files). T018-T022 are strictly sequential — all five edit `server/src/controllers/chat.ts`.
- **Phase 4 (US2)**: the four deletions T027-T030 in parallel; T033, T034 and T045 in parallel with each other.
- **Phase 5 (US3)**: T053 (schema JSON) in parallel with T050-T052.
- **Phase 6 (US4)**: T058-T060 are sequential — all three build `grounding.ts`.
- **Phase 7 (US5)**: T070 in parallel with nothing else in its phase that matters; T072 and T073 both touch admin components and T072 must precede T073's use of its styles.
- **Phase 8 (US6)**: T076 in parallel with T077-T079, which are sequential in `change-sets.ts`.
- **Phase 9**: T089, T090 and T091 in parallel.
- **Across stories**: US5 and US6 can be worked concurrently with US3/US4 by a second pair of hands, with the caveat that US5's T072 and US6's T083 both edit `admin/src/components/styles.ts`, and US5's T073 and US6's T084 both edit `admin/src/components/MessageList.tsx`.

---

## Parallel Example: User Story 1

```bash
# The two catalog modules, different surfaces, no shared file:
Task: "T010 Create the declarative provider table in server/src/services/providers.ts"
Task: "T011 Create the client-side provider catalog in admin/src/data/providers.ts"

# NOT parallel — all five edit server/src/controllers/chat.ts:
#   T018 request path, T019 persistence, T020 stop, T021 image withholding, T022 error handling
```

## Parallel Example: User Story 2

```bash
# Four independent deletions:
Task: "T027 Delete admin/src/components/ModeSelect.tsx"
Task: "T028 Delete admin/src/components/AuditReportCard.tsx"
Task: "T029 Delete server/src/services/audit-qa.ts and server/src/services/audit-security.ts"
Task: "T030 Delete server/src/policies/has-audit-permission.ts"
```

---

## Implementation Strategy

### MVP scope: US1 + US2 (both P1)

The specification marks two stories P1, and they are the MVP together. US1 alone is the harder half —
the provider layer plus the rewritten request path — but shipping it without US2 leaves a mode
selector above a product that has one mode, and leaves the retired audit capability reachable. The
smallest honest increment is:

1. Phase 1 Setup — **T001 first**, in its own `docs:` commit
2. Phase 2 Foundational
3. Phase 3 US1 → **stop and verify** quickstart §A and §G1-G3 in a running admin panel
4. Phase 4 US2 → **stop and verify** quickstart §B
5. Ship

### Incremental delivery

Each phase below the MVP is independently shippable and independently verifiable, matching the
specification's story boundaries:

1. Setup + Foundational → foundation ready
2. US1 → four providers answering live (SC-001, SC-002) → ship
3. US2 → one mode, audit retired (SC-003) → ship
4. US3 → versioned deterministic instructions (SC-004) → ship
5. US4 → grounded prompt (SC-005, SC-006, SC-011) → ship
6. US5 → copyable output (SC-007) → ship
7. US6 → approve & publish (SC-008, SC-010) → ship
8. Polish → the README reconciled, the bundle measured, SC-009 and SC-012 swept

### Parallel team strategy

With two pairs of hands, after Foundational: one takes the server spine in order
(US1 → US2 → US3 → US4), the other takes US5 then US6 — coordinating on
`admin/src/components/styles.ts` and `admin/src/components/MessageList.tsx`, the only two files both
tracks touch.

---

## Notes

- **[P] means different files.** Two tasks naming the same path are never parallel, however
  unrelated their subjects — `chat.ts`, `grounding.ts`, `change-sets.ts`, `styles.ts` and
  `MessageList.tsx` each carry several tasks.
- **No test tasks by design.** Constitution V makes a running admin panel the gate; the spec puts an
  automated suite explicitly out of scope. The verification tasks are the tests.
- **"Should work" is not verification.** A provider that has not answered a real message has not been
  verified, and a scenario reasoned about has not been observed.
- **`dist/` is part of the change, not a follow-up.** Every commit that touches source rebuilds and
  stages it.
- Commits go directly to `main` — no feature branches, no co-authorship trailers (CLAUDE.md).
- Stop at any checkpoint to verify a story independently.
