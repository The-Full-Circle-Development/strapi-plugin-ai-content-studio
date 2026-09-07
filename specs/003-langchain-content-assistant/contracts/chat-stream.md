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
| To wire | `result.pipeUIMessageStreamToResponse(ctx.res, { originalMessages, onFinish })` | `toUIMessageStream(stream)` → `tee()` → `pipeUIMessageStreamToResponse({ response, stream })` |
| Persist | SDK's `onFinish({ responseMessage })` | `readUIMessageStream({ stream })` on the second tee branch |

`convertToModelMessages` is **not** used as an intermediate step: `toBaseMessages` takes
`UIMessage[]` directly, which is the shape the history rebuild already produces.

---

## 3. Persistence — the one part of the bridge that is hand-built

The standalone `pipeUIMessageStreamToResponse` has no `originalMessages` and no
`onFinish({ responseMessage })`; those exist only on `streamText`'s result method
(research D5). So:

```text
const [toClient, toStore] = toUIMessageStream(agentStream).tee();

pipeUIMessageStreamToResponse({ response: ctx.res, stream: toClient, headers });

// Consumed unconditionally — see the backpressure rule below.
let finalMessage;
for await (const message of readUIMessageStream({ stream: toStore })) {
  finalMessage = message;              // each yield is a fuller state of the same message
}
// finalMessage.parts is what chat-message.parts stores.
```

**Rules, each of which was free before and is now ours to keep:**

1. **Both branches must be drained.** An unread `tee` branch applies backpressure and will stall the
   response. The store branch is consumed on every path — success, provider error, and abort.
2. **A persistence failure must never surface as a provider error.** Catch, log through
   `redact.describeError`, and leave the stream alone. The existing discipline in the current
   controller carries over verbatim.
3. **The user's turn is still persisted before streaming begins**, so a crash or disconnect
   mid-generation leaves an honest record of what was asked.
4. **`promptVersion` is recorded on the assistant turn** from `InstructionSet.version` (FR-019).
5. **Stored history never holds attachment bytes.** File parts are filtered out before persistence,
   exactly as today.
6. **The stored shape must be compared, not assumed.** Before this commit lands, a turn stored after
   the change is diffed against a turn stored before it: same part types, same field names, same
   nesting. This is the check that makes FR-013 true rather than hoped for.

---

## 4. Stop must release server-side work

Unchanged in behaviour, rewired in mechanism (FR-009).

- The Koa `close` / `aborted` wiring stays: a close **before** the stream finished is a real stop; a
  close after normal completion is not.
- `abort.signal` is passed as `agent.stream(state, { signal })` — the verified LangChain
  equivalent of `abortSignal`.
- An aborted turn still:
  - keeps its partial output and is marked interrupted, so it reads as interrupted rather than as a
    reply that trailed off;
  - appends the `data-interrupted` part carrying `appliedSince({ threadId, ownerId, since })`, so a
    plan the editor approved **while the turn was still streaming** is still reported. Silence about
    that is the one dishonest outcome available here;
  - leaves the thread usable.
- No further tool step may begin after abort.

---

## 5. Step bound

`stopWhen: stepCountIs(8)` becomes `recursionLimit`.

**The arithmetic matters.** `recursionLimit` counts LangGraph **super-steps**, not model calls. One
ReAct iteration is a model node plus a tool node, so `N` model calls with tool use consume
approximately `2N` super-steps plus the terminal model node. To preserve today's ceiling of 8 model
steps, `recursionLimit` is set to **17** (`2 × 8 + 1`).

This is a behaviour-visible constant: too low silently truncates a turn that needed several
discovery calls before proposing; too high burns provider tokens. It is confirmed by observing a real
multi-tool turn complete, and the number is revisited if the observed step accounting differs.

---

## 6. Tool activity must stay visible

`toUIMessageStream` emits the full tool lifecycle — verified in `@ai-sdk/langchain@3.0.93`:
`tool-input-start`, `tool-input-delta`, `tool-input-available`, `tool-input-error`,
`tool-output-available`, `tool-output-error`.

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
- A provider whose streaming behaves differently — no incremental tool signalling, different stop
  semantics — must either hold the visible contract or state the difference in the interface. It may
  never silently degrade.
