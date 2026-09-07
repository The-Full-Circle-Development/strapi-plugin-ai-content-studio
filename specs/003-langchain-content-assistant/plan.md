# Implementation Plan: Unified Provider Layer, Single Content Mode & Project-Grounded Prompt

**Branch**: `main` (this repository commits directly to `main`) | **Date**: 2026-09-07 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/003-langchain-content-assistant/spec.md`

## Summary

Language-model access moves behind **LangChain** (`langchain` v1 `createAgent`), with chat models
built as instances from a declarative table of statically-imported providers and handed to
`createAgent` through its `model` option (**not** `llm`: that option does not exist in
`langchain@1.5.10` — see tasks.md → Deviations) — Anthropic, OpenAI and
Google Generative AI, plus one generic **OpenAI-compatible** provider whose configuration carries an
administrator-supplied base URL, which is what makes the long tail (Groq, Mistral, DeepSeek,
Together, Fireworks, Ollama, vLLM, self-hosted…) reachable with no per-provider code. `initChatModel`
is not used: it resolves providers through a runtime dynamic import that esbuild cannot bundle, which
would break the committed-`dist/` distribution outright ([research.md](research.md) D2).

The AI SDK stays in the request path as the **wire and storage format only** —
`@ai-sdk/langchain`'s `toBaseMessages` / `toUIMessageStream` bridge LangChain's stream into the UI
message protocol the browser already speaks and the database already stores. That is what keeps
FR-009's chat contract and FR-013's replay of pre-existing conversations true through a provider-layer
rewrite. Persistence needs no hand-built plumbing at all: the bridge's chunks are merged into
`createUIMessageStream`, whose `onFinish({ responseMessage })` is field-for-field the callback the
controller already uses, and whose assembler is the same one `streamText` reaches today — so the
stored `parts` shape stays byte-compatible **by construction** (D5, corrected).

One open risk sat under all of this as a **blocking prerequisite of the dependency install**:
`@ai-sdk/langchain@3.0.93` is ESM-only, declares `engines: node >= 22` against this repo's Node 20
floor, and hard-depends on `ai@7.0.93` while this repo pinned `ai@6.0.208` (D17).

**RESOLVED at install time.** All three findings are real in 3.0.93 and all three are absent from
the 2.x line, which D17 lists as the preferred fallback: `2.0.285` is dual-format (CJS + ESM with a
`require` condition), declares `node >= 18`, and depends on `ai@6.0.277` — the same major this repo
uses. Pinning it avoids upgrading to `ai@7`, which would have moved the wire and storage format
FR-013 exists to freeze. Verified by bundling the whole tree into a CommonJS bundle with esbuild,
loading it, and constructing all three providers offline.

Around that: the three-mode selector and the read-only audit capability are removed outright; the
instructions become explicit, sectioned and **version-derived-from-their-own-text** so an edit cannot
ship without changing the version; a deterministic, permission-scoped, size-bounded description of
the running install's schema is embedded in them and is inspectable from settings; assistant replies
and their code blocks become copyable; and the plan card gains an **Approve & Publish (Risky)** action
that runs as a second phase of the existing apply call, permission-checked per document at the moment
of application.

## Technical Context

**Language/Version**: TypeScript 5, Node `>=20.0.0 <=24.x.x`, CommonJS package type, React 18

**Primary Dependencies**:

| Package | Version verified this session | Role |
|---|---|---|
| `langchain` | 1.5.10 | `createAgent` (ReAct tool loop), `tool()` |
| `@langchain/core` | 1.2.9 | peer of the above; message and tool primitives |
| `@langchain/anthropic` | 1.5.9 | `ChatAnthropic` |
| `@langchain/openai` | **1.5.5** (pinned) | `ChatOpenAI` — also the OpenAI-compatible path via `configuration.baseURL`. 1.5.10+ declares `node >= 22`, which would break this repo's Node 20 floor, so the newest `>= 20` release is pinned |
| `@langchain/google-genai` | 2.3.0 | `ChatGoogleGenerativeAI` |
| `@ai-sdk/langchain` | **2.0.285** (pinned) | `toBaseMessages`, `toUIMessageStream`. NOT 3.0.93 — see Risks, all three D17 findings resolved |
| `ai` | **6.0.277** (pinned, was `^6`) | `createUIMessageStream`, `pipeUIMessageStreamToResponse`, `UIMessage`/`UIMessageChunk` types. Pinned to the version the bridge pins, so exactly ONE copy of `ai` exists |
| `@ai-sdk/react` | **3.0.280** (pinned, was `^3`) | `useChat` on the admin side, unchanged in use. Pinned only so it shares the one `ai@6.0.277` copy |
| `zod` | ^4 (already present) | tool input and settings validation |
| `@strapi/design-system` / `@strapi/icons` | v2 (already present) | all new UI |
| `jest` + a TS transform | to be pinned in T005a | the four pure-function suites (FR-055). Chosen because Strapi's own packages run jest — verified in the installed `@strapi/strapi` and `@strapi/sdk-plugin`. `devDependencies`, never shipped in `dist/` |

Removed: `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google` — no longer imported.
Transitively arriving with `langchain`: `@langchain/langgraph`, `@langchain/langgraph-checkpoint`,
`langsmith` (tracing stays off by default — D8).

**Storage**: Strapi plugin store (settings, encrypted keys) + four plugin content types
(`chat-thread`, `chat-message`, `change-set`, `preview-session`). One additive column:
`chat-message.promptVersion`. No migration; `chat-thread.mode` and `chat-message.modeAtSend` become
vestigial and are deliberately left in place (D12).

**Testing**: this feature introduces the repository's **first automated tests** (FR-055) — four
suites over pure functions, run by **jest**, chosen because it is what Strapi itself uses
(`@strapi/strapi` and `@strapi/sdk-plugin` both run `jest`, verified in the installed packages).
`corepack pnpm@10 run test` joins the per-commit gate.

The line between the two halves is what can actually fail. **Automated**: the byte-identical
composition of the instructions, the deterministic derivation and tiered degradation of the install
description, the declared image-input rule, and configuration normalization — pure functions whose
determinism is itself the requirement, so no suite calls a model, opens a socket, or boots a host,
and a red test is a defect rather than a flake. **Manual**, in a running Strapi admin panel: one live
send per shipped provider whose path changed, one permission-denied path per new write surface, and
everything else that only fails in integration — streaming, tool activity, stop, replay, the UI.
Scripted in [quickstart.md](quickstart.md). Model *behaviour* is never asserted in a test.

**Target Platform**: Strapi v5 admin panel (server: Node; client: React 18 in the admin bundle)

**Project Type**: Strapi v5 plugin — `admin/` (React) + `server/` (Node), built into a committed `dist/`

**Performance Goals**: the visible chat contract is the goal, not a throughput number — first token
streams progressively, tool activity appears as it happens, stop ends server-side work. The install
description must not crowd the conversation: a thirty-turn conversation on the largest available
project still completes (SC-011).

**Constraints**:

- Consumers install no AI dependencies and run no build step, so every provider must bundle into the
  committed `dist/` (Principle IV). This is the hard bound on provider breadth.
- Provider credentials stay AES-256-GCM encrypted, write-only, masked on read; nothing
  credential-shaped may appear in any error, log, transcript or interface state (Principle I).
- Every read and every applied change re-checks the **caller's live** ability; the ability is never
  cached across requests or users (Principle II).
- The install description has a declared character budget and must be byte-identical for identical
  request inputs (FR-018, FR-030, FR-032).
- Every shipped user-facing string and the instruction text is in English (FR-025, SC-012).
- No model identifier is written from memory, and the curated list has exactly one home (`CLAUDE.md`).
  This feature adds no identifier: new providers use direct identifier entry (FR-004).

**Scale/Scope**: ~9,600 lines of existing source across 56 files. This feature touches roughly two
thirds of the server services, rewrites the chat request path, deletes 4 files (2 services, 1 policy,
2 admin components), and adds 5 (1 admin data module, 2 server services, 1 admin hook, 1 admin
component). Grounding must stay bounded on installs with hundreds of content types and deeply nested
components.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Re-evaluated after Phase 1. Result: **passes, conditional on the constitution amendment in D16
landing first.** Two rules name the AI SDK by name and must be reworded before any commit that
contradicts them.

| Rule | Verdict | How this design satisfies it |
|---|---|---|
| **I — Secrets encrypted and never echoed** | Pass, extended | Keys stay AES-256-GCM in the plugin store, write-only, masked on read; only the active provider's key is decrypted, per request. The **new** config value — a provider base URL — is validated, stored as its own field, rendered in its own labelled input, and never presented next to or as part of the credential (FR-008). `langsmith` tracing is off by default so no prompt or run data leaves the host (D8). Provider errors keep going through `redact.describeError`, and `showProviderErrorDetails` still gates detail. **New no-echo surface to verify**: the grounding inspector (FR-035) — the description is schema-only by construction (FR-029), and SC-009 measures zero credential occurrences across it. |
| **II — Per-caller RBAC on every content tool** | Pass | Every ported tool keeps its body: uid allow-list → `permission-checker` on the **caller's** ability → compact JSON → structured errors, rebuilt per request (D7). The install description is filtered by the same live `can.read()` and **authorizes nothing** (FR-031, FR-037). The new publish phase re-checks `publish` **per document at the moment of application** (FR-046) — a separate action from the `update` already checked, never inherited from it. Settings routes stay super-admin only; the new grounding-inspector route is gated `settings.read`. The retired `audit.run` action is unregistered. |
| **III — Provider neutrality, runtime switchable** | Pass on intent; **letter requires amendment** | Providers stay interchangeable from the UI with no redeploy: the active pair is resolved from persisted config **per request**, so a rotated key or changed model takes effect on the next message (FR-007). Nothing branches on provider identity for core chat behaviour (FR-001) — the only provider-shaped data is the table's declared capabilities. Model lists stay curated and hardcoded in `admin/src/data/models.ts`; **no catalog endpoint is ever fetched** (FR-003). A provider without a curated list degrades to direct identifier entry and says so in the UI, breaking nothing for the others (FR-004). **The letter that fails**: "resolved per request through the AI SDK provider registry" — see D16. |
| **IV — Self-contained distribution** | Pass on intent; **letter requires amendment** | All LangChain packages stay in `devDependencies`, never `peerDependencies`, and are bundled into the committed `dist/`. This is why `initChatModel` is rejected (D2) and why breadth is delivered by a configurable compatible endpoint rather than sixteen bundled packages (D3). `dist/` is rebuilt and staged in the same commit as every source change; bundle size is measured before and after (D8). Removed permission actions and capabilities are documented as breaking changes naming the version (FR-054). **The letter that fails**: "The AI SDK MUST stay bundled into `dist/`" names one vendor — see D16. |
| **V — Verified in a real admin panel** | Pass, tightened | `corepack pnpm@10 run typecheck` **and `corepack pnpm@10 run test`** clean before every commit. The principle already anticipated this — "once a test suite exists it MUST pass and this principle tightens rather than relaxes" — and T001 records that one now does (FR-055). Manual verification per [quickstart.md](quickstart.md) is unchanged in scope for everything that only fails in integration: one live send per shipped provider, one permission-denied path for the publish action, and the ten-question structural probe (SC-005/SC-006). What moves to the suite is only what a human could not honestly repeat — SC-004's ten identical compositions and the tier degradation. No claim of "should work": a provider that has not answered a real message has not been verified. |
| **Technology & Security Constraints** | Pass | Strapi v5 / Node 20-24 / CommonJS / React 18 unchanged. pnpm 10 via corepack. No new `any` in exported signatures; zod v4 validates every tool input and settings payload (`langchain` accepts zod v4 — D7). UI is `@strapi/design-system` v2 + `@strapi/icons` v2 only — the copy control and the publish confirmation add **no** UI dependency. All plugin routes stay `type: 'admin'` under `/ai-content-studio/*`; the only non-admin surface remains the pre-existing token-gated preview. The `services → controllers → routes → policies` layering is preserved and crypto stays isolated in `services/crypto.ts`. Every new setting has a safe default so an upgrade never breaks an existing install — grounding defaults **on** because it is deterministic, bounded, permission-filtered and inspectable (FR-036). |
| **Governance — complexity** | **Violation, recorded not waived** | "Added dependencies MUST be justified against a concrete need in the feature spec. Absent that justification, the simpler option is required." The research found a simpler option reaching identical provider breadth at no dependency cost (D1, D3). The dependency proceeds on the maintainer's explicit decision. See Complexity Tracking. |
| **Governance — NON-NEGOTIABLE re-check** | Required | Principles I and II must be re-checked on every commit touching `server/src/services/` or `server/src/routes/`. This feature touches both heavily; the re-check is a step in each affected task. |

**Gate outcome**: proceed. No unresolved `NEEDS CLARIFICATION` remains ([research.md](research.md)
→ Resolved unknowns). The one blocking prerequisite is ordering, not redesign: **the constitution
amendment is the first commit.**

## Project Structure

### Documentation (this feature)

```text
specs/003-langchain-content-assistant/
├── plan.md                          # This file
├── research.md                      # Phase 0 — D1..D16, all unknowns resolved
├── data-model.md                    # Phase 1
├── quickstart.md                    # Phase 1 — the manual verification pass
├── contracts/                       # Phase 1
│   ├── provider-layer.md            # provider table, config shape, settings API
│   ├── chat-stream.md               # the preserved wire + storage contract
│   ├── instructions.md              # section order, version derivation
│   ├── install-description.md       # determinism, scoping, size budget
│   ├── apply-and-publish.md         # apply route delta, per-item outcomes
│   └── removals.md                  # breaking changes
├── checklists/
│   └── requirements.md              # existing
└── tasks.md                         # Phase 2 — /speckit-tasks, NOT created here
```

### Source Code (repository root)

```text
admin/src/
├── components/
│   ├── ChangePlanCard.tsx           # CHANGED  Approve & Publish (Risky) + its confirmation
│   ├── Composer.tsx                 # CHANGED  hint loses its mode branch
│   ├── CopyButton.tsx               # NEW      message + code-block copy control
│   ├── MessageList.tsx              # CHANGED  copy controls; audit card branch removed
│   ├── ModeSelect.tsx               # DELETED
│   ├── AuditReportCard.tsx          # DELETED
│   ├── PreviewPanel.tsx             # unchanged
│   ├── ThreadSidebar.tsx            # CHANGED  header prop no longer carries a mode control
│   └── styles.ts                    # CHANGED  styles for copy + risky action
├── data/
│   ├── models.ts                    # UNCHANGED IN STRUCTURE — curated lists only (D15)
│   ├── providers.ts                 # NEW      shipped-provider catalog (client mirror)
│   └── loadingWords.ts              # unchanged
├── hooks/
│   ├── useCopy.ts                   # NEW      clipboard with fallback + explicit failure
│   ├── useChangeSet.ts              # CHANGED  publish + confirmPublish through apply
│   ├── useThreads.ts                # CHANGED  mode members removed
│   └── useAttachments.ts            # unchanged
├── pages/
│   ├── Chat.tsx                     # CHANGED  no mode wiring
│   └── Settings.tsx                 # CHANGED  provider catalog, direct model entry, base URL,
│                                    #          grounding toggle, grounding inspector
└── permissions.ts                   # unchanged (audit action was never listed here)

server/src/
├── content-types/
│   └── chat-message/schema.json     # CHANGED  + promptVersion (nullable)
├── controllers/
│   ├── chat.ts                      # REWRITTEN  LangChain agent + bridged stream + tee persistence
│   ├── change-sets.ts               # CHANGED    apply accepts publish + confirmPublish
│   └── settings.ts                  # CHANGED    provider catalog, baseUrl, grounding; + grounding read
├── policies/
│   ├── has-audit-permission.ts      # DELETED    (already unreferenced by any route)
│   ├── index.ts                     # CHANGED
│   └── is-super-admin.ts            # unchanged
├── routes/index.ts                  # CHANGED    + GET /settings/grounding (settings.read)
├── services/
│   ├── providers.ts                 # NEW        declarative table: static imports + capabilities
│   ├── registry.ts                  # REWRITTEN  resolve active provider -> chat model instance
│   ├── agent.ts                     # NEW        build the per-request createAgent instance
│   ├── grounding.ts                 # NEW        the deterministic install description
│   ├── prompt.ts                    # REWRITTEN  sectioned instructions + derived version
│   ├── tools.ts                     # REWRITTEN  LangChain tool(); one mode's tool set
│   ├── change-sets.ts               # CHANGED    publish phase inside apply
│   ├── config.ts                    # CHANGED    extensible providers map, baseUrl, grounding;
│   │                                #            audit options removed
│   ├── audit-qa.ts                  # DELETED
│   ├── audit-security.ts            # DELETED
│   ├── index.ts                     # CHANGED
│   ├── threads.ts                   # CHANGED    record promptVersion; stop resolving mode
│   ├── attachments.ts               # unchanged
│   ├── crypto.ts                    # unchanged
│   ├── preview.ts                   # unchanged
│   └── redact.ts                    # unchanged
├── bootstrap.ts                     # CHANGED    audit.run action unregistered
├── config/index.ts                  # CHANGED    + grounding; audit key removed
└── types.ts                         # CHANGED    audit types removed; outcome extended; new types

dist/                                # REBUILT and staged in the same commit as every source change
README.md                            # CHANGED    providers, grounding, publish action, breaking changes
CLAUDE.md                            # CHANGED    registry.ts description now names the LangChain path
.specify/memory/constitution.md      # AMENDED    1.0.0 -> 1.1.0, in its own `docs:` commit, FIRST
```

**Structure Decision**: the existing two-surface plugin layout is kept exactly —
`admin/` (React) and `server/` (Node) built into a committed `dist/`, with the server's
`services → controllers → routes → policies` layering preserved per the Technology & Security
Constraints. The provider layer is deliberately split in two: `services/providers.ts` holds the
declarative table (static imports and declared capabilities — the only file that changes when a
provider is added or dropped), while `services/registry.ts` keeps its name and its job of resolving
the active provider from persisted config per request. Keeping that filename keeps `CLAUDE.md`'s
pointer to `modelSupportsVision()` true, and keeps the "adding a provider is one table row" property
legible in a single file. `services/agent.ts` and `services/grounding.ts` are new services rather than
controller code, so the request path stays thin and both are reachable from the settings inspector.

## Implementation Order

Ordered by dependency, not by story priority. Each numbered item is one commit with a conventional
subject; the per-commit gate (typecheck clean, `dist/` rebuilt and staged, manual verification,
docs moved) applies to every one of them.

1. **`docs:` constitution amendment** — 1.0.0 → 1.1.0 with a Sync Impact Report (D16). Must precede
   every commit below, so nothing is committed against a constitution it violates.
2. **Provider layer** (US1, P1) — `services/providers.ts`, `services/registry.ts`,
   `services/config.ts`, `controllers/settings.ts`, `admin/src/data/providers.ts`,
   `pages/Settings.tsx`. Ends with all four shipped providers configurable and one live send each.
3. **Chat request path** (US1, P1) — `services/agent.ts`, `services/tools.ts`,
   `controllers/chat.ts`. This is the riskiest commit: the streaming, tool-activity, stop and
   persistence contract all move at once, and [contracts/chat-stream.md](contracts/chat-stream.md) is
   the checklist it must satisfy. Old-conversation replay is verified here, not later.
4. **Single mode** (US2, P1) — delete `ModeSelect.tsx`, strip mode from `useThreads`, `Chat.tsx`,
   `Composer.tsx`, `ThreadSidebar.tsx`, `threads.ts`, `types.ts`.
5. **Audit retirement** (US2, P1) — delete both audit services, the policy, `AuditReportCard.tsx`,
   the audit types, the config key, and the `audit.run` action; document the breaking change.
6. **Instructions** (US3, P2) — `services/prompt.ts` sectioned and version-derived; `promptVersion`
   column and its recording in `threads.ts`.
7. **Grounding** (US4, P2) — `services/grounding.ts`, its instruction section, the `grounding`
   config option, and the settings inspector route and panel.
8. **Copy** (US5, P3) — `useCopy.ts`, `CopyButton.tsx`, `MessageList.tsx`.
9. **Approve & Publish** (US6, P3) — `services/change-sets.ts` publish phase,
   `controllers/change-sets.ts`, `useChangeSet.ts`, `ChangePlanCard.tsx`.
10. **`docs:` README** — providers and how to configure one, the removed modes and capabilities, the
    grounding setting and its default, the new approval action, and every breaking change with its
    version (FR-053, FR-054). Items 2-9 each carry their own README delta; this one reconciles the
    whole page.

Items 4-9 are independently shippable and independently verifiable, matching the specification's
story boundaries. Items 2 and 3 are one capability split across two commits only because the second
is large — the provider layer is not verifiable until item 3 lands, so item 2's live sends are
performed as part of item 3's verification pass.

**Task-to-commit mapping lives in [tasks.md](tasks.md) → Commit mapping**, and it records one
deviation from the list above: items 4 and 5 land as a **single** commit, because removing the
`mode` parameter and deleting the two audit tools are edits to the same function in
`services/tools.ts`, and one B-scenario pass verifies both halves.

## Risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| **`@ai-sdk/langchain@3.0.93`'s packaging fights this repo's** — ESM-only, `engines: node >= 22`, and a hard `ai@7.0.93` dependency against our `ai@6.0.208` (D17) | A second major of `ai` in one bundle means two `UIMessageChunk` identities and a possible move in the stored `parts` shape — the one failure FR-013 cannot absorb. The engine floor would be a breaking change for consumers on Node 20 | **Answered at install time, before any code is written against the bridge** (T002): bundle it, run `pnpm why ai`, read the lockfile. If `ai@7` is a second copy, either upgrade this repo to `ai@7` and re-run the FR-013 shape diff for real, or pin an older bridge whose peer is `ai@6`. |
| The bridged stream diverges from the current UI part shapes | Silently corrupts stored history | The stream is assembled by the SDK's own `createUIMessageStream` → `handleUIMessageStreamFinish`, the same path `streamText` takes today (D5, corrected), so the shape is not hand-derived. Verification still compares a freshly stored turn's `parts` against a pre-change turn's before item 3 is committed — that diff is also what would catch the `ai@7` problem above. |
| **A provider's raw error text reaches the browser past every mask** — the bridge enqueues `{type:'error', errorText}` itself rather than throwing, so no `onError` callback ever sees it | Straight at FR-008 and SC-009: whatever the provider put in that message is echoed to the editor | Redaction is a `TransformStream` over the merged chunks, not a callback ([contracts/chat-stream.md](contracts/chat-stream.md) §8, T022). SC-009's sweep is what proves it. |
| The model-call ceiling moves silently | A tighter ceiling truncates multi-tool turns; a looser one burns tokens | `modelCallLimitMiddleware({ runLimit: 8 })` counts model calls directly, so there is no super-step arithmetic to get wrong, and it ends the turn cleanly instead of raising `GraphRecursionError` mid-stream. Confirmed by observing a turn that needs several discovery calls. |
| Bundle growth in a committed `dist/` | Every consumer pays it on install | Measured before and after (baseline recorded: `dist/server/index.js` = 1,600,257 bytes), with the three `@ai-sdk/*` provider packages removed as an offset. **No size gate, on the maintainer's explicit decision**: the growth is accepted as the price of the provider layer, because a git dependency is fetched once and then cached — the cost lands at install, not per use, and no editor pays it again. The number is still recorded and stated in the commit body, so the cost is known rather than discovered later. |
| `langsmith` arrives as a `langchain` dependency | Tracing would send prompts and run data to a third party — a Principle I failure, not just a performance one | No `LANGSMITH_*` / `LANGCHAIN_*` tracing is enabled by this plugin; verified absent from the request path and stated in the README. |
| A compatible endpoint that only implements `/chat/completions` | The provider appears configured and fails on every send | `useResponsesApi` stays `false` (verified default — D3) and no feature that forces the Responses surface is requested. Each shipped provider gets one live send. |
| Grounding crowds the context on a large install | Long conversations stop completing (SC-011) | Declared character budget with three-tier deterministic degradation and an explicit partial marker (D9); verified on the largest available project over thirty turns. |
| Appending to `models.ts` breaks the session-context hook silently | Costs the reminder's accuracy with no build failure | The provider catalog goes in a separate module; `models.ts` keeps its parseable structure untouched (D15). |

## Complexity Tracking

> Filled because the Constitution Check records one violation.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| New dependency tree (`langchain`, `@langchain/core`, `@langchain/anthropic`, `@langchain/openai`, `@langchain/google-genai`, `@ai-sdk/langchain`, and transitively `@langchain/langgraph`, `@langchain/langgraph-checkpoint`, `langsmith`) against Governance's "absent that justification, the simpler option is required" | The maintainer's explicit decision, taken after being shown the finding below. The specification's breadth clarification names LangChain as the layer that owns which providers exist, and the original request asked to move to it. | **It was not rejected on the evidence — it was overridden.** The research found that keeping the AI SDK and restructuring `registry.ts` into a declarative provider table plus `@ai-sdk/openai-compatible` reaches identical provider breadth (both libraries need one bundled package per provider; the unbounded tail comes from a configurable compatible endpoint either way — D2, D3), at zero dependency cost, with no risk to the streaming, tool-activity, stop and replay behaviour FR-009 and FR-013 require preserved. This row exists so that trade is on the record rather than dressed up as a capability gap. |
| Two constitution rules reworded (Principle III's resolution mechanism, Principle IV's bundling clause) | Both name the AI SDK by name; this feature keeps their intent and contradicts their letter (D16) | Not amending would mean committing against a constitution the code violates, which Governance forbids. Amending is therefore the smaller act — and it is a rewording, not a removal: provider neutrality, runtime switchability, the no-`/models`-fetch rule and the bundling requirement all survive intact. Version 1.1.0, own `docs:` commit, Sync Impact Report updated, landing before any implementation commit. |
