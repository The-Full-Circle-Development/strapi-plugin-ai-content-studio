# Phase 0 Research: Unified Provider Layer, Single Content Mode & Project-Grounded Prompt

**Feature**: `specs/003-langchain-content-assistant` | **Date**: 2026-09-07

Every version number, API name and default in this document was read from the package or the
provider's own documentation **in this session**. Line references point at the file inspected.
Nothing here is recalled.

**No model identifiers appear in this document.** Per `CLAUDE.md`, an identifier ships only after
verification against the provider's live catalog in the session that ships it, and the curated list
has exactly one home (`admin/src/data/models.ts`). Every decision below is arranged so that no new
identifier is needed: providers added by this feature use direct identifier entry (FR-004).

---

## D1. The adapter layer is LangChain (`langchain` v1 `createAgent`)

**Decision**: language-model access moves to LangChain. Chat models are constructed as **instances**
from a declarative, statically-imported provider table and handed to `createAgent({ llm, tools,
prompt })`. `initChatModel` is **not** used. The AI SDK stays in the request path solely as the
**wire and storage format** via `@ai-sdk/langchain`.

**Rationale**: this is the maintainer's explicit decision, taken with the finding in D2 in hand. The
original request named LangChain, and the specification's breadth clarification names it as the
layer that owns which providers exist.

**How it is reached**: `createAgent` accepts *either* `options.llm` (a chat-model instance) or
`options.model` (a string identifier). Verified in `langchain@1.5.10`
`dist/agents/index.d.ts:63-64`:

> `@param options.llm - The language model as an instance of a chat model`
> `@param options.model - The language model as a string identifier`

Taking the `llm` branch is what makes D2's packaging problem avoidable: the string branch resolves
through `initChatModel`, the `llm` branch never does.

**Alternatives considered**:

- **Keep the AI SDK, restructure `registry.ts` into a provider table + `@ai-sdk/openai-compatible`.**
  Rejected by maintainer decision. On the evidence it reaches identical provider breadth (D3) at no
  dependency cost and with zero risk to the streaming, tool-activity and replay behaviour FR-009 and
  FR-013 require preserved. Recorded in `plan.md` → Complexity Tracking, because the constitution's
  Governance clause requires a new dependency to be justified against a concrete need and the
  concrete need here is a stated preference rather than a capability gap.
- **LangChain without `createAgent`** — `model.bindTools(tools)` plus a hand-written tool loop on
  `@langchain/core` only, which would avoid pulling `@langchain/langgraph`,
  `@langchain/langgraph-checkpoint` and `langsmith` (D8). Rejected: `toUIMessageStream` derives
  `tool-output-available` chunks from an agent/graph stream, and a hand-rolled loop would have to
  synthesize the whole tool-part lifecycle by hand — the exact surface FR-009 says must not
  visibly degrade. Paying dependency weight to keep a working contract is the better trade.
- **`initChatModel('provider:model')`** — see D2. Not viable in this distribution.

---

## D2. `initChatModel` is unusable here, and the reason is structural

**Finding**: `initChatModel` resolves each provider with a **runtime dynamic import of a variable
specifier**. Verified in `langchain@1.5.10` `dist/chat_models/universal.cjs:135`:

```js
return (await import(config.package))[config.className];
```

…where `config.package` comes from the `MODEL_PROVIDER_CONFIG` table in the same file. The failure
path is explicit about the expectation (same file, immediately below):

```js
throw new Error(`Unable to import ${attemptedPackage}. Please install with \`npm install ${attemptedPackage}\``);
```

esbuild cannot statically resolve a variable specifier, so the package is **not** bundled into
`dist/`. It must exist in the consumer's `node_modules`. That contradicts Principle IV (`dist/` is
committed, consumers install no AI dependencies and run no build step) and FR-011 directly.

**Consequence for the design**: the provider table is a set of **static imports**, one per shipped
provider, each bundled into `dist/`. Adding a provider is one static import plus one table row — no
integration code, no branch in the request path (FR-001, FR-002). A provider whose package is not
imported is simply absent from the table, which is exactly FR-011's "absent rather than offered and
broken".

**The 19 provider keys `initChatModel` knows** (16 distinct packages), read from the same table:
`openai`, `anthropic`, `azure_openai`, `langsmith`, `cohere`, `google`, `google-vertexai`,
`google-vertexai-web`, `google-genai`, `ollama`, `mistralai`, `mistral`, `groq`, `bedrock`, `aws`,
`deepseek`, `xai`, `cerebras`, `fireworks`, `together`, `perplexity`. This is the ceiling on
"however many providers LangChain supports" via that entry point — and every one of them needs its
own package present, so none of them is free.

---

## D3. Breadth comes from the OpenAI-compatible endpoint, not from the package count

**Decision**: ship three first-party providers (Anthropic, OpenAI, Google Generative AI — the three
that already work, so no install regresses) plus one **generic OpenAI-compatible provider** whose
configuration includes an administrator-supplied base URL.

**Rationale**: bundling is the real bound on breadth, and it is the same bound for either library —
LangChain needs one package per provider (D2), the AI SDK needs one package per provider. Neither
gives unbounded breadth by bundling. The one mechanism that *is* unbounded is a configurable
OpenAI-compatible endpoint: one adapter, zero per-provider code, and it reaches Groq, Mistral,
DeepSeek, Together, Fireworks, Perplexity, Cerebras, xAI, OpenRouter, Ollama, vLLM, LM Studio and
any self-hosted server speaking the same wire format. This is the path the specification anticipates
("covering the tail through a generic compatible-endpoint provider", and FR-008's base-URL clause).

**Mechanism**: `ChatOpenAI` accepts `configuration?: ClientOptions` — the OpenAI client's own
options object, which carries `baseURL`. Verified in `@langchain/openai@1.5.11`
`dist/types.d.ts` (`configuration?: ClientOptions`).

**The load-bearing default** — `ChatOpenAI.useResponsesApi` defaults to **`false`**. Verified in
`@langchain/openai@1.5.11` `dist/chat_models/index.js` (`useResponsesApi ?? false`) and documented
in `dist/chat_models/index.d.ts:15-18`:

> Whether to use the responses API for all requests. If `false` the responses API will be used only
> when required in order to fulfill the request.

This matters for the same reason `CLAUDE.md` says to confirm an identifier is reachable through the
surface the plugin actually uses: a third-party compatible endpoint implements `/chat/completions`
and not `/responses`. So the compatible provider **must** leave `useResponsesApi` false and must not
request a feature that forces the Responses surface. Recorded as an invariant in
`contracts/provider-layer.md`.

**Alternatives considered**:

- **Bundle all 16 LangChain provider packages.** Rejected: it multiplies `dist/` (D8) to buy
  endpoints the compatible provider already reaches, and each package is a new upgrade obligation.
- **Let an administrator name any `@langchain/*` package to load.** Rejected: FR-002 forbids
  introducing a provider the layer does not know, and it would reintroduce D2's runtime import.
- **A hosted gateway** (route everything through one aggregator credential). Rejected: it would send
  customers' content through a third party this plugin has no contract with, and it is not in the
  specification.

---

## D4. The AI SDK stays as the wire format — this is what preserves FR-009 and FR-013

**Decision**: keep `@ai-sdk/react`'s `useChat` on the client, keep the UI message stream protocol on
the wire, and keep `chat-message.parts` in AI SDK `UIMessage` part shape. Bridge with
`@ai-sdk/langchain@3.0.93`.

**Rationale**: FR-009 requires the existing chat contract to be preserved and FR-013 requires
conversations stored before this change to replay. Those stored `parts` **are** AI SDK UI parts.
Changing the wire format would mean rewriting the client and either migrating or reinterpreting every
stored row — a large, irreversible risk for no user-visible gain. Keeping the format makes the
provider swap invisible to both the browser and the database.

**The three functions this rests on**, read from `@ai-sdk/langchain@3.0.93/dist/index.d.ts`:

| Function | Signature | Replaces |
|---|---|---|
| `toBaseMessages` | `(messages: UIMessage[]) => Promise<BaseMessage[]>` | `convertToModelMessages` |
| `toUIMessageStream` | `(stream: AsyncIterable<AIMessageChunk> \| ReadableStream, options?) => ReadableStream<UIMessageChunk>` | `streamText`'s UI stream |
| `convertModelMessages` | `(modelMessages: ModelMessage[]) => BaseMessage[]` | (unused here) |

**Verified chunk coverage.** `toUIMessageStream` emits, per `dist/index.js`: `start`, `start-step`,
`text-start`, `text-delta`, `text-end`, `reasoning-start`, `reasoning-delta`, `reasoning-end`,
`tool-input-start`, `tool-input-delta`, `tool-input-available`, `tool-input-error`,
`tool-output-available`, `tool-output-error`, `tool-approval-request`, `source-url`,
`source-document`, `file`, `finish-step`, `finish`, `error`. That is a **superset** of what
`admin/src/components/MessageList.tsx` renders today, and it includes the exact tool lifecycle that
file depends on: `isToolUIPart(part)` with `part.state === 'output-available'` is how the change plan
card is found (`MessageList.tsx:365-376`). Tool pills, the plan card and the apply report therefore
keep working unchanged.

`tool-approval-request` / `tool-approval-response` are LangChain's own human-in-the-loop mechanism.
They are **deliberately unused**: approval in this plugin is structural — the model can only record a
pending plan, and the sole write path is the user's click on `POST /change-sets/:id/apply`. Routing
approval through the model's own loop would move a guarantee out of deterministic server code and
into model behaviour.

**Image input.** `toBaseMessages` converts AI SDK `file` parts — including `data:` base64 URLs — into
LangChain `{ type: 'image', … }` content blocks (`dist/index.js:141-231`, `convertImageToContentBlock`
plus the `case "file"` branch, which parses `^data:([^;]+);base64,(.+)$`). So the vision path survives
the swap, and FR-006's default-deny gate stays where it is: bytes are filtered out **before**
conversion when the active model is not declared vision-capable.

---

## D5. Persistence must be rebuilt on `readUIMessageStream` (a real gap in the bridge)

**Finding**: the standalone `pipeUIMessageStreamToResponse` exported by `ai@6.0.208` takes only
`{ response, stream }` plus response init — **no `originalMessages`, no `onFinish({ responseMessage })`**.
Verified in `node_modules/ai/dist/index.d.ts:4363-4366`:

```ts
declare function pipeUIMessageStreamToResponse({ response, status, statusText, headers, stream, consumeSseStream }: {
    response: ServerResponse;
    stream: ReadableStream<UIMessageChunk>;
} & UIMessageStreamResponseInit): void;
```

Those options exist only on `streamText`'s **result method** of the same name, which is what
`server/src/controllers/chat.ts:220-224` uses today to get `responseMessage` in exactly the shape
`chat-message.parts` stores.

`toUIMessageStream`'s own `onFinish` is **not** a substitute: its argument is the LangGraph final
state, not an assembled UI message (`ToUIMessageStreamOptions.onFinish?: (finalState: TState | undefined) => …`).

**Decision**: `tee()` the `UIMessageChunk` stream. One branch goes to
`pipeUIMessageStreamToResponse`; the other is consumed by `readUIMessageStream({ stream })`, whose
last yielded `UIMessage` is the assembled assistant turn. Persist `that.parts`.

`readUIMessageStream` is exported by `ai@6.0.208` and documented as returning "an
`AsyncIterableStream` of `UIMessage`s… each stream part is a different state of the same message as
it is being completed" (`dist/index.d.ts:4368-4383`). Because it is the AI SDK's own assembler, the
stored shape stays byte-compatible with what the current code writes — which is precisely what makes
FR-013 hold for conversations written before *and* after this change.

**Consequences to build deliberately, because they were free before**:

- **Abort.** The interrupted marker (`data-interrupted`) and the `appliedSince` report are appended
  by our own code, not by an SDK callback. The Koa `close`/`aborted` wiring in
  `chat.ts:180-191` is kept as-is and `abort.signal` is passed to `agent.stream({ signal })`.
- **Both branches must be drained.** An unread `tee` branch applies backpressure and will stall the
  response. The persistence branch is consumed unconditionally, including on error and abort.
- **A persistence failure must never surface as a provider error** — the existing try/catch
  discipline at `chat.ts:254-259` carries over.

**Alternatives considered**:

- **Assemble parts by hand from `AIMessageChunk`s.** Rejected: it re-implements the AI SDK's
  assembler, and any divergence silently corrupts stored history — the one failure FR-013 cannot
  tolerate.
- **Persist LangChain `BaseMessage`s instead.** Rejected: it changes the storage format, breaks
  replay of existing rows, and forces a client rewrite. Directly contrary to D4.

---

## D6. Abort and step bounds map cleanly

**Decision**: `agent.stream(state, { signal, recursionLimit })`.

Verified in `langchain@1.5.10` `dist/agents/ReactAgent.d.ts:154-156`:

> `@param config.signal - An optional AbortSignal for the agent execution.`
> `@param config.recursionLimit - The recursion limit for the agent execution.`

| Today (`ai`) | After (LangChain) |
|---|---|
| `streamText({ abortSignal })` | `agent.stream(state, { signal })` |
| `stopWhen: stepCountIs(8)` | `recursionLimit` |

`recursionLimit` counts **graph super-steps**, not model calls: one ReAct turn is a model node plus a
tool node. The value must be chosen so the effective ceiling on model calls is not quietly tightened
or loosened relative to today's 8 steps, and the chosen number is recorded in
`contracts/chat-stream.md` with its arithmetic. This is a behaviour-visible constant, so it is
verified by observation in the admin panel (a plan that needs several discovery calls must still
complete), not by reasoning alone.

---

## D7. Tools port shape-for-shape

**Decision**: `tool(fn, { name, description, schema })` from `langchain`, with the existing zod v4
schemas reused verbatim.

Verified in `langchain@1.5.10` `dist/agents/index.d.ts:74-90` (the documented example imports
`{ createAgent, tool }` from `"langchain"` and passes `schema: z.object({ … })`), and
`langchain`'s own `dependencies` declare `zod: ^3.25.76 || ^4` — so the repository's zod v4 is
supported without a second zod copy.

Every constitutional property of the current tools is a property of the **function body**, not of the
SDK wrapper: uid allow-list, `permission-checker` check against the caller's live ability before the
Document Service, compact/truncated JSON, and structured `{ ok: false, error, message }` returns
instead of throws. Porting therefore changes the wrapper and nothing inside it. Principle II is
unaffected — and the per-request rebuild from `(caller ability, threadId, ownerId, manifestOrdinals)`
stays, because the ability must never be cached across users.

The tool set becomes the single mode's set: `listContentTypes`, `searchEntries`, `getEntry`,
`describePageStructure`, `proposeChanges`. `describePageStructure` moves into it unconditionally —
FR-014 requires structure discovery in the only mode there is. `runQaScan` and `runSecurityAudit` are
deleted (D11).

---

## D8. Dependency weight is real and must be measured, not estimated

**Baseline measured this session**: `dist/server/index.js` = 1,600,257 bytes; `dist/` total = 4.5 MB.

**What arrives**: `langchain@1.5.10`, whose own `dependencies` (read from its `package.json`) are
`@langchain/langgraph ^1.4.10`, `@langchain/langgraph-checkpoint ^1.1.5`, `langsmith >=0.5.0 <1.0.0`
and `zod`, with `@langchain/core ^1.2.9` as a peer; plus `@langchain/anthropic@1.5.9`,
`@langchain/openai@1.5.11`, `@langchain/google-genai@2.3.0`, and `@ai-sdk/langchain@3.0.93`.

**What leaves**: `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google` are no longer imported and
are removed. `ai` **stays** — `pipeUIMessageStreamToResponse`, `readUIMessageStream` and the
`UIMessage`/`UIMessageChunk` types are the wire and storage contract (D4, D5). `@ai-sdk/react` stays
on the admin side untouched, so the admin bundle is essentially unmoved.

**Decision**: all of these stay in `devDependencies` and are bundled into `dist/`, per Principle IV.
`langsmith` telemetry must be **off** unless a project opts in: no `LANGSMITH_*` / `LANGCHAIN_*`
tracing is enabled by this plugin, and no run data leaves the host by default. This is a Principle I
concern, not merely a performance one — a tracing client that ships prompts to a third party would
carry customer content and, at worst, credential-shaped text.

**Gate**: the built server bundle size is recorded before and after in `quickstart.md`. A large
regression is a finding to report, not a silent cost.

---

## D9. The install description: deterministic by construction

**Decision**: generate it from `strapi.contentTypes` (keys prefixed `api::`), `strapi.components`, and
the plugin's own `getPreviewOptions().paths`. Never from the host's source code (FR-028).

**Determinism rules** (FR-030), each chosen so no output can vary between two identical requests:

| Input that could vary | Rule |
|---|---|
| key iteration order | every list sorted lexicographically — content types by uid, attributes by name, enum values in their declared order (schema order is stable and is itself information) |
| section order | fixed and declared in `contracts/install-description.md` |
| time | no timestamps anywhere in the text |
| content volume | no counts of entries, no "most recent", nothing read from the Document Service |
| a language model | none involved; this is string assembly |

**Permission scope** (FR-031): a content type appears only if
`permission-checker.create({ userAbility, model: uid }).can.read()` allows it — the same live check
every tool makes, so the description can never widen what the caller may see. It **authorizes
nothing**: apply-time re-checks are untouched (FR-037).

**Reuse without staleness** (FR-033): cache keyed on a **schema fingerprint** (a hash over the
canonically serialized `api::*` schemas plus components) and a **readable-uid fingerprint** (a hash
of the caller's sorted readable uid list — the only ability input that can change the output). A new
content type changes the schema fingerprint, so the next request regenerates with no restart. Two
accounts with different access get different, individually stable descriptions.

**Size budget** (FR-032): a declared character budget with a three-tier deterministic degradation —
full detail; then component expansions dropped; then identifiers, kinds and flags only. The tier is
chosen by the same rule every time, the text carries an explicit partial marker, and the marker
instructs the assistant to discover the remainder with tools.

**Alternatives considered**:

- **Analyse the host's source code.** Rejected in the specification and confirmed here: it is not
  reproducible across the different projects this plugin ships to, its cost scales with the host
  repository rather than the schema, and it makes the instructions depend on files the plugin has no
  contract with.
- **Cache with a TTL.** Rejected: a TTL makes the description a function of *when* you asked, which
  is exactly the non-determinism FR-030 exists to prevent.
- **Summarize the schema with a model.** Rejected: non-deterministic by construction, and it would
  spend a provider call to produce the input to a provider call.

---

## D10. The instruction version is derived, not maintained

**Decision**: compose the instructions from declared sections in a fixed order, and derive the
version as a stable hash of the concatenated **behavioural** section text at module load —
`v<N>-<first 8 hex of sha256>`.

**Rationale**: FR-026 requires that any edit to the instruction text change its version identifier
*in the same change*. A hand-maintained constant makes that a discipline a maintainer can forget; a
derived hash makes it structural — editing a single character changes the identifier automatically,
and it cannot be changed without editing the text. The leading `v<N>` stays hand-set so a
maintainer can still mark a deliberate generation.

The install description is **not** part of the hash. The version identifies the *rules in force*; the
description is per-install fact, differs per account, and folding it in would make the version churn
per install and destroy its traceability value. Recorded per stored assistant turn as
`chat-message.promptVersion`.

`crypto.createHash` from `node:crypto` is already available in this codebase
(`server/src/services/crypto.ts`), so this adds no dependency.

---

## D11. Retiring the audit capability, and what "no remnant" means for stored history

**Decision**: delete `server/src/services/audit-qa.ts`, `server/src/services/audit-security.ts`,
`server/src/policies/has-audit-permission.ts` (already unreferenced by any route — dead on arrival),
`admin/src/components/AuditReportCard.tsx`, the `runQaScan` / `runSecurityAudit` tools, the audit
types in `server/src/types.ts`, the `audit` config key and `getAuditOptions()`, and the
`audit.run` permission action registered in `server/src/bootstrap.ts`.

**How stored history stays honest** (FR-013 vs FR-016): a conversation containing a `runQaScan` tool
part still replays. With `auditReportOf` gone, that part falls through to the generic tool pill
("Used runQaScan") — the turn reads as a thing that happened, without offering a capability that no
longer exists. No migration, no rewriting of stored transcripts.

**The retired capability must be *said*, not silently missing** (US2-5, FR-016): the instructions
gain a short "retired capabilities" rule so a request for a QA scan or a security audit is answered
plainly rather than improvised around.

**Upgrade safety** (FR-054): unregistering a permission action does not fail an upgrade — a role's
stored grant for a no-longer-registered action is inert. It is documented as a breaking change in
`README.md` naming the version and what a consumer who granted it should do.

---

## D12. Mode removal: stop reading the columns, do not migrate them

**Decision**: `chat-thread.mode` and `chat-message.modeAtSend` stay in the schema untouched. The
client stops sending a mode, the server stops resolving or persisting one, and `modeAtSend` takes its
existing schema default.

**Rationale**: the specification's own assumption — legacy values are ignored, not migrated, because
removing the stored value is not required for correctness and leaving it untouched is the least
destructive option for existing conversations. Both columns are `required` enumerations; altering
them is a schema change against live consumer databases, for no behavioural gain. FR-017 governs
**user-visible text**, and a vestigial column is not user-visible. It is documented as vestigial so
the next reader does not mistake it for live state.

Deleted on the client: `admin/src/components/ModeSelect.tsx`, and every mode-shaped member of
`useThreads` (`mode`, `setMode`, `modeRef`, `changeMode`). The composer's hint loses its
mode-conditional branch (`Chat.tsx:288-292`) and always speaks about approval.

---

## D13. Copy: attempt, fall back, then fail out loud

**Decision**: try `navigator.clipboard.writeText`; on absence or rejection fall back to a hidden
textarea plus `document.execCommand('copy')`; if that also fails, show an explicit error.

**Rationale**: `navigator.clipboard` requires a secure context. A Strapi admin panel served over
plain HTTP on a LAN host is **not** a secure context, so the modern API is simply absent there —
common enough in the self-hosted deployments this plugin targets that a single-path implementation
would appear broken. FR-040 forbids a silent no-op, so the last step is a visible failure message,
never a swallowed rejection.

**What gets copied**: an assistant turn's Markdown **source** is already in hand — the `text` parts
of the stored message are Markdown, so joining them reproduces it exactly (FR-038). Per-code-block
copying uses a custom `code` renderer passed to `react-markdown`, which receives the raw block
contents (FR-039). A message that is only a structured card gets a plain-text rendering of the card,
or no control at all — never a control that copies nothing (FR-043).

**Accessibility** (FR-041): a real focusable `button` with an English `aria-label` and a
`role="status"` confirmation, so the outcome is announced rather than only coloured.

---

## D14. Approve & Publish is a second phase of the existing apply call

**Decision**: extend `POST /change-sets/:id/apply` with `publish: true` and `confirmPublish: true`
rather than adding a separate publish route. Publish runs **per distinct affected document**, after
the write phase, inside the same call.

**Rationale**: three requirements pin this together. FR-050 requires one per-item report stating both
what was written and whether it was published, persisted into the transcript. FR-049 requires that an
item whose target moved on is neither applied nor published — one decision, two effects. And a second
route would re-enter the gate on a set that is already `applied`, which the existing
`not_pending` rule correctly refuses (`change-sets.ts:530-538`). Keeping it in one call keeps the
existing six-step gate as the single place where approval is decided.

**Publish is document-scoped, reported per item.** Two field changes on one document produce one
publish. Its outcome is attributed to each contributing item so the report reads per item as FR-050
requires. Only items that actually reached `applied` contribute a document — a `stale`, `blocked` or
`failed` item never causes a publish.

**Per-document permission at the moment of application** (FR-046): `can(uid, 'publish', …)` against
the caller's live ability, evaluated in the publish phase — not inherited from the write phase's
`update` check, because they are different actions and a caller may hold one without the other. A
refusal is reported as blocked with its reason, never skipped.

**Non-draft-and-publish targets** (FR-047): reported as live on save, with no publish attempted. The
existing `usesDraftAndPublish(uid)` helper (`change-sets.ts:85`) already answers this.

**The consequence the plan card cannot show** (FR-045): publishing is document-scoped, so another
editor's unreviewed draft edits on the same document go live too. This is invisible in the plan's
own before/after rows, which is exactly why the confirmation text must state it before the editor
commits. A single activation publishes nothing; the destructive-item confirmation remains separate
and additional (FR-048).

**Alternatives considered**:

- **A separate `POST /change-sets/:id/publish`.** Rejected for the `not_pending` conflict above and
  because it would split one outcome report across two transcript entries.
- **Have the assistant add publish items to the plan.** Rejected: that is today's behaviour, and the
  specification's point is that going live must be the editor's deliberate act rather than something
  the model thought to propose.

---

## D15. Two data files, not one — the session hook makes this load-bearing

**Decision**: the shipped-provider catalog goes in a **new** `admin/src/data/providers.ts`.
`admin/src/data/models.ts` keeps only the curated model lists, structurally unchanged.

**Rationale**: `.claude/hooks/session-model-context.mjs` parses `models.ts` as text, starting at
`source.indexOf('export const MODELS')` and scanning **to end of file with no terminator**
(`parseCatalog`, lines 67-95). Any later line matching `/^\s*([A-Za-z_$][\w$]*)\s*:\s*\[/` is read as
a phantom provider group. A provider catalog appended to that file would therefore corrupt the
session reminder — silently, because the hook degrades to emitting its standing rule alone rather
than failing. A separate module removes the hazard entirely and keeps `models.ts` exactly what
`CLAUDE.md` says it is.

It also protects that file's other documented invariant — "every provider array has at least one
entry", because `Settings.tsx:189-191` indexes `MODELS[next][0].id` unguarded. Providers shipped
without a curated list (D3) would break that index. So `Settings.tsx` must switch to
`MODELS[providerId] ?? null` and offer direct identifier entry when there is no curated list
(FR-004), which is the same code path that keeps a saved non-curated identifier working verbatim
(FR-005).

Per `CLAUDE.md`, any change to the curated list moves `README.md` and `dist/` in the same commit.
This feature does not change the curated list itself — it changes how a missing list is handled — but
it does change what `README.md` must say about providers, so the README moves regardless (FR-053).

---

## D16. Two constitution rules name the AI SDK by name

**Finding**: this feature contradicts the **letter** of two ratified rules while keeping their
intent:

- Principle III: "The provider/model pair is resolved per request through the AI SDK provider
  registry."
- Principle IV: "The AI SDK MUST stay bundled into `dist/`; AI packages stay in `devDependencies`,
  never `peerDependencies`."

**Decision**: amend `.specify/memory/constitution.md` to name **the provider-adapter layer** rather
than one vendor's SDK, in its **own `docs:` commit** with an updated Sync Impact Report, per
Governance. Version 1.0.0 → **1.1.0**: no principle is removed or incompatibly redefined — provider
neutrality, runtime switchability, the no-`/models`-fetch rule and the bundling rule all survive
intact — but the rules are materially reworded, which is more than a clarification.

The amendment lands **before** the implementation commits that contradict the current text, so no
commit is made against a constitution it violates. Principle III's substantive clauses are unchanged
and still hold under this design: nothing branches on provider identity for core behaviour, model
lists stay curated and hardcoded in one file, and no catalog is ever fetched.

---

## Resolved unknowns

Every `NEEDS CLARIFICATION` raised while filling the Technical Context is closed above.

| Unknown | Resolved by |
|---|---|
| Which adapter layer, and can LangChain ship in a committed `dist/`? | D1, D2 |
| How wide can the shipped provider set be? | D3 |
| Does the chat contract survive the swap? | D4, D6 |
| How is a turn persisted without `streamText`'s `onFinish`? | D5 |
| How do tools and their RBAC gates port? | D7 |
| What does the new dependency cost? | D8 |
| How is grounding made deterministic, scoped and bounded? | D9 |
| How is the instruction version kept truthful? | D10 |
| How is the audit capability removed without breaking replay? | D11 |
| What happens to the stored mode columns? | D12 |
| How does copy behave without a secure context? | D13 |
| Where does publish belong, and what must its confirmation say? | D14 |
| Where does the provider catalog live? | D15 |
| Does this violate the constitution? | D16 |
