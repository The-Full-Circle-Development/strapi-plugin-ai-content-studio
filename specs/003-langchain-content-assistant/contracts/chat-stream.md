# Contract: Chat Stream — the wire and storage format that must not move

**Feature**: `specs/003-langchain-content-assistant` | Covers FR-009, FR-013, FR-001, FR-023

This is the checklist the riskiest commit must satisfy. The provider layer changes underneath; the
browser's protocol and the database's shape **do not change at all**. Every item below is verified by
observation in a running admin panel, not by reasoning.

---

## 1. What stays exactly as it is

| Surface | Status |
|---|---|
| `POST /ai-content-studio/chat` path, policies (`admin::isAuthenticatedAdmin` + `chat.use`) | unchanged |
| `@ai-sdk/react`'s `useChat` in `admin/src/pages/Chat.tsx` | unchanged |
| `DefaultChatTransport`, its headers and `credentials` | unchanged (`mode` leaves the body) |
| The UI message stream protocol on the wire | unchanged |
| `chat-message.parts` shape | unchanged — AI SDK `UIMessage` parts |
| Every renderer in `admin/src/components/MessageList.tsx` | unchanged except copy controls and the deleted audit branch |
| Owner-scoped thread lookup; a foreign `threadId` is a `404` | unchanged |
| Server-side history rebuild — the browser's list is a view, the thread is the record | unchanged |
| Older-turn condensation into `contextSummary` | unchanged |
| Attachment manifest as text, referred to by stable ordinal, ingested only on approval | unchanged (FR-023) |

**The client is not modified for the provider swap.** If the client needed a change, the wire format
moved, and the contract is broken.

---

## 2. The request path, before and after

| Step | Before (`ai`) | After (LangChain) |
|---|---|---|
| Build model | `registry.getActiveModel()` → `LanguageModel` | `registry.getActiveModel()` → `BaseChatModel` instance |
| Build tools | `tools.buildTools({ userAbility, mode, … })` → `ToolSet` | `tools.buildTools({ userAbility, … })` → `tool()[]` |
| Build instructions | `prompt.build({ mode, … })` | `prompt.build({ … })` → `InstructionSet` |
| Convert history | `convertToModelMessages(replayed)` | `toBaseMessages(replayed)` |
| Run | `streamText({ model, system, messages, tools, stopWhen, abortSignal })` | `createAgent({ llm, tools, prompt }).stream({ messages }, { signal, recursionLimit })` |
| To wire | `result.pipeUIMessageStreamToResponse(ctx.res, { originalMessages, onFinish })` | `pipeUIMessageStreamToResponse({ response: ctx.res, stream: createUIMessageStream({ originalMessages, onError, execute, onFinish }) })` |
| Persist | SDK's `onFinish({ responseMessage })` | **the same SDK `onFinish({ responseMessage })`** — this row no longer moves (§3) |

`convertToModelMessages` is **not** used as an intermediate step: `toBaseMessages` takes
`UIMessage[]` directly, which is the shape the history rebuild already produces.

---

## 3. Persistence — the SDK's, not ours

*Rewritten 2026-09-07. The previous version teed the stream and drained the second branch by hand,
because research D5 concluded `onFinish({ responseMessage })` existed nowhere in `ai@6.0.208`. It
exists — on the **producer** side, which D5 did not search. See D5's correction block.*

```ts
pipeUIMessageStreamToResponse({
  response: ctx.res,
  headers,
  stream: createUIMessageStream({
    originalMessages: messages,
    onError,                                   // client-facing message mapper — see §8
    execute: ({ writer }) => { writer.merge(toUIMessageStream(agentStream, { onError: log, onAbort })); },
    async onFinish({ responseMessage }) { /* today's persistence body, verbatim */ },
  }),
});
```

**No `tee`. No drain rule. No accumulation loop.** One stream, so backpressure is the pipe's own, and
`onFinish` fires from the transform's `flush()` and `cancel()`, guarded against double-calling.

**Why this is the safe option rather than the clever one**: `createUIMessageStream` ends in
`handleUIMessageStreamFinish` → `createStreamingUIMessageState` + `processUIMessageStream` — the same
functions `readUIMessageStream` calls, and the same ones `streamText`'s result method reaches. The
stored shape is therefore identical to today's **by construction**, not by two code paths agreeing.

**Rules that remain:**

1. **A persistence failure must never surface as a provider error.** Catch, log through
   `redact.describeError`, and leave the stream alone. This now also covers anything thrown inside
   `execute`: `createUIMessageStream` converts a throw there into an `{type:'error'}` chunk the editor
   sees, which is exactly what this rule forbids.
2. **The user's turn is still persisted before streaming begins**, so a crash or disconnect
   mid-generation leaves an honest record of what was asked.
3. **`promptVersion` is recorded on the assistant turn** from `InstructionSet.version` (FR-019).
4. **Stored history never holds attachment bytes.** File parts are filtered out before persistence,
   exactly as today.
5. **`originalMessages` is not optional here.** The bridge emits a bare `{ type: 'start' }` with no
   `messageId`, and the assembler only sets the message id when the chunk carries one. Without
   `originalMessages` the stored turn gets `id: ''` and the browser is sent no id at all — a defect
   the teed design would have shipped silently.
6. **The stored shape must still be compared, not assumed.** A turn stored after the change is diffed
   against one stored before it: same part types, same field names, same nesting. Construction makes
   this likely; the diff makes it known — and it is also the check that catches a second copy of `ai`
   arriving at a different major version (research D17).

---

## 4. Stop must release server-side work

Unchanged in behaviour, rewired in mechanism (FR-009).

- The Koa `close` / `aborted` wiring stays: a close **before** the stream finished is a real stop; a
  close after normal completion is not.
- `abort.signal` is passed as `agent.stream(state, { signal })` — the verified LangChain
  equivalent of `abortSignal`.
- **`onFinish`'s `isAborted` cannot be trusted here.** It is set only by an `{ type: 'abort' }` chunk,
  and `@ai-sdk/langchain@2.0.285` never emits one. The interrupted branch keeps reading the Koa flag
  above. (Alternatively `writer.write({ type: 'abort' })` from the abort handler makes `isAborted`
  honest — `abort` is a member of the chunk union, so it typechecks.)
- **A stop must not read as a failure.** On an `AbortError` the bridge calls `onAbort()` and then
  enqueues `{ type: 'error', errorText }`, so an editor who pressed stop would be shown an error.

  > **CORRECTED 2026-09-07 (implementation).** This bullet used to say the chunk could be
  > "suppressed through the bridge's own `onAbort`". It cannot. `onAbort` is `() => void`, and the
  > bridge's `catch` block enqueues the error chunk **unconditionally** — after whichever callback
  > ran, with no way for either to prevent it. Verified in the installed
  > `@ai-sdk/langchain@2.0.285` (`src/adapter.ts`).
  >
  > The suppression therefore has to happen in the same `TransformStream` §8 already requires for
  > redaction: when the turn was stopped, the `{type:'error'}` chunk is **dropped**; otherwise its
  > `errorText` is rewritten through `redact.describeError`. One transform, two jobs, because both
  > concern the same chunk on the same path.

  Verify this in the panel, not on paper.
- An aborted turn still:
  - keeps its partial output and is marked interrupted, so it reads as interrupted rather than as a
    reply that trailed off;
  - carries the `data-interrupted` part with `appliedSince({ threadId, ownerId, since })`, so a plan
    the editor approved **while the turn was still streaming** is still reported. Silence about that
    is the one dishonest outcome available here. It is now **written into the stream** —
    `writer.write({ type: 'data-interrupted', data })` — rather than spliced into the assembled parts
    array afterwards: one typed call reaches both the wire and the database, replacing the
    `[...parts]` copy and its `as never` cast. Write it **after** the merged stream drains, and catch
    `appliedSince`'s own failure locally (§3 rule 1). Note `writer.merge()` returns `void`, not a
    promise, so "after the merged stream drains" means the redaction transform's `flush()` — the one
    hook that reliably runs after the source closes and before `onFinish` assembles the message. Note this also makes the notice visible live
    rather than only on reload — an improvement, but a client-visible change to check in the panel;
  - leaves the thread usable.
- No further tool step may begin after abort.

---

## 5. Step bound

`stopWhen: stepCountIs(8)` becomes `recursionLimit`.

**Prefer the middleware that counts the right thing.** `langchain@1.5.10` ships
`modelCallLimitMiddleware({ runLimit: 8, exitBehavior: 'end' })`, which counts **model calls** —
exactly what `stepCountIs(8)` counted — and needs no translation:

```ts
createAgent({ llm, tools, prompt, middleware: [modelCallLimitMiddleware({ runLimit: 8, exitBehavior: 'end' })] })
```

It also ends the turn cleanly on the limit, where `recursionLimit` raises a `GraphRecursionError`
mid-stream that the editor would see. Two caveats, both checked: on the `'end'` path it appends a
synthetic English `AIMessage` naming the limit, which streams to the client and is persisted; and it
was read from the published `1.5.10` tarball, so **re-read
`dist/agents/middleware/modelCallLimit.d.ts` after T002's install** before relying on it.

**Keep `recursionLimit` as a backstop, not as the mechanism.** It still guards a loop that never
reaches a model node, and the arithmetic is why the old number was fragile: it counts LangGraph
**super-steps**, so one ReAct iteration is a model node plus a tool node, and preserving 8 model steps
meant `2 × 8 + 1 = 17`. Too low silently truncates a turn that needed several discovery calls before
proposing; too high burns provider tokens. With the middleware carrying the real ceiling, the backstop
can be generous.

---

## 6. Tool activity must stay visible

`toUIMessageStream` emits the full tool lifecycle — verified in `@ai-sdk/langchain@2.0.285`:
`tool-input-start`, `tool-input-delta`, `tool-input-available`, `tool-input-error`,
`tool-output-available`, `tool-output-error`.

**This holds for the LangGraph stream mode only.** Consumed through `agent.streamEvents()` instead,
the bridge emits just `tool-input-start` and `tool-output-available` — no `tool-input-available`, no
`tool-input-delta`, so tool **inputs** never reach the UI or storage. The change-plan card keys on
`output.changeSetId` and would survive; the tool pills would lose their arguments. The controller
therefore uses the LangGraph mode, and this contract names it rather than leaving it to whichever
call shape lands first (research D17).

That is exactly what the existing renderer consumes:

| Rendered surface | How it is found | Must still work |
|---|---|---|
| Tool pill ("Using X…" / "Used X" / "X failed") | `isToolUIPart(part)` + `part.state` | yes |
| Change plan card | `getToolName(part) === 'proposeChanges'` && `state === 'output-available'` && `output.ok && output.changeSetId` | yes — this is the approval surface |
| Apply report | persisted `data-apply-report` part | yes |
| Interrupted notice | persisted `data-interrupted` part | yes |
| Reasoning text | `part.type === 'reasoning'` | yes, where the provider emits it |
| Audit report card | deleted | **no** — falls through to a generic tool pill on replay (see §7) |

`tool-approval-request` / `tool-approval-response` are LangChain's own human-in-the-loop mechanism and
are **deliberately unused**. Approval here is structural: the model can only record a pending plan,
and the sole write path is the editor's click on `POST /change-sets/:id/apply`. Routing approval
through the model's loop would move a guarantee out of deterministic server code into model
behaviour.

---

## 7. Replay of conversations stored before this change

FR-013. Verified against a conversation created under the old build, including one recorded under a
mode that no longer exists.

| Stored artefact | On replay |
|---|---|
| Any turn's `parts` | renders as before — the shape did not change |
| `modeAtSend` / thread `mode` holding `layout` or `audit` | ignored; the thread opens, replays fully, and accepts a new message |
| A `runQaScan` / `runSecurityAudit` tool part | renders as a generic tool pill. It reads as something that happened, **without implying the capability is still available** |
| A `data-apply-report` part | renders as before; new reports additionally carry publish outcomes |
| A `promptVersion` of `null` | honest — those turns predate versioning. Never backfilled with a guess |
| A held attachment that was never ingested | still reported as no longer held, inviting re-attachment |

---

## 8. Error handling

- Configuration problems (all five `ProviderConfigError` codes) are raised **before** generation and
  answered as ordinary HTTP errors naming the provider (FR-010).
- Provider errors during the stream are logged server-side through `redact.describeError`, and
  surfaced to the editor as a generic message unless `showProviderErrorDetails` is on — in which case
  the **redacted** detail is shown. Nothing credential-shaped is echoed anywhere, on any path
  (FR-008, SC-009).

- **⚠ The SDK's `onError` mask does not cover this path, and assuming it does is a credential-leak
  hole.** `createUIMessageStream`'s `onError?: (error: unknown) => string` only fires for errors that
  *escape* to it. The bridge never lets one escape: on a provider failure it catches the throw itself
  and enqueues `{ type: 'error', errorText: errorObj.message }` — the provider's **raw** message,
  straight to the browser, past every mask. This is true of the teed design too; it is not a
  consequence of §3's rewrite, it was simply never noticed.

  So redaction **must be a `TransformStream` over the merged chunk stream**, rewriting every
  `{type:'error'}` chunk's `errorText` through `redact.describeError` before it reaches the wire —
  not an SDK callback. Both hooks are still used and they are not interchangeable: the bridge's
  `onError(error: Error)` is the **server-side logger** (void), `createUIMessageStream`'s
  `onError(unknown) => string` is the **client-facing mapper** for anything that does escape, and the
  transform is what actually guards the path the provider's own text takes. Verified against
  `@ai-sdk/langchain@2.0.285`'s source; SC-009's sweep is what proves it in practice.
- A provider whose streaming behaves differently — no incremental tool signalling, different stop
  semantics — must either hold the visible contract or state the difference in the interface. It may
  never silently degrade.
