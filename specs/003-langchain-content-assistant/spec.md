# Feature Specification: Unified Provider Layer, Single Content Mode & Project-Grounded Prompt

**Feature Branch**: `main` (this repository commits directly to `main`; spec directory is `specs/003-langchain-content-assistant`)

**Created**: 2026-09-04

**Status**: Draft

**Input**: User description: "Move to LangChain, for its ability to add many LLM providers instead of me hard-coding them. Keep only content editing mode and remove the dropdown above the chat history. Also make the system prompt more detailed. If it is possible, build something that analyses the project's structure and logic in detail and includes that in the system prompt as well — but I am not sure how best to do this, because this plugin is used on different projects, and determinism in the model's logic is a priority, as is its system prompt. Also add the ability to copy the output, and an 'Approve & Publish (Risky)' button or something along those lines. Write the spec in English."

**On provider breadth (clarified during specification)**: "However many providers LangChain supports is how many there should be — you are wiring up LangChain. That is LangChain's area of responsibility, not yours."

**On the audit capability (clarified during specification)**: retire it fully, as a breaking change, together with the mode that reached it.

**Language**: this specification, the assistant's system instructions, and every shipped user-facing
string are written in English. The original request was made in Ukrainian and is rendered above in
English for that reason.

## Overview

Six changes, all serving one product decision: this plugin is a **content-editing assistant**. The
mode selector, the two extra modes, and the hand-written per-provider integration each either
narrow that purpose or dilute it.

1. **Provider breadth becomes the adapter layer's job.** Language-model access moves behind one
   adapter layer, and the set of usable providers is whatever that layer supports — not a set this
   plugin re-implements provider by provider.
2. **One mode.** The three-mode selector above the conversation list is removed. Content Editing is
   the only mode there is, and the read-only audit capability is retired with the mode that reached
   it.
3. **A detailed system prompt.** The instructions the assistant runs under become explicit and
   thorough, and are versioned so a change to them is a deliberate, traceable act.
4. **A prompt grounded in the install it runs in.** The prompt gains a generated, deterministic
   description of *this* project's structure — content types, components, relations, publication
   behaviour — so the assistant stops guessing at field names. The plugin ships to many different
   projects, so this description must be derived at runtime; and because the model's behaviour must
   stay predictable, the same install must produce the same instructions on every request.
5. **Copyable output.** An editor can copy what the assistant wrote.
6. **Approve & Publish in one deliberate action.** An editor can approve a plan and publish its
   results without leaving the panel, behind an explicit risk confirmation.

The safety model does not change: the assistant proposes, the editor approves, and the caller's own
permissions are the boundary.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Every provider the adapter layer supports is reachable (Priority: P1)

An administrator opens the plugin settings and finds the providers the adapter layer supports —
not a shortlist this plugin hand-wrote. They choose one, choose a model (from a curated list where
the maintainer has verified one, or by entering the provider's own model identifier where there is
no curated list), save a credential, and the next message goes to that provider. No restart, no
redeploy, and no plugin release was needed to make that provider work.

**Why this priority**: provider lock-in and redeploy-to-switch are the two problems this plugin
exists to solve. Today the provider set is a hand-written branch in one function plus parallel
literal unions in several files, so every addition edits all of them and every edit is a chance to
break the providers that already worked. Delegating breadth to the adapter layer is what makes the
provider list stop being this repository's maintenance burden.

**Independent Test**: for each provider configured in turn — including at least one that the plugin
did not previously support — send one live message that requires a tool call and produces a change
plan; verify streaming text, visible tool activity, the plan card, stop, approval, and the per-item
report all behave as they do today.

**Acceptance Scenarios**:

1. **Given** a provider with a saved credential and a model selected, **When** an editor sends a
   message, **Then** the reply streams progressively, tool activity is visible as it happens, and a
   proposed change renders as an approvable plan card — identical behaviour to before this change.
2. **Given** a provider the plugin did not support before this change but the adapter layer does,
   **When** an administrator configures it, **Then** it is selectable and works, with no
   plugin-side integration code written for it.
3. **Given** the active provider is switched in settings, **When** the next message is sent,
   **Then** it reaches the newly selected provider with no restart and no redeploy.
4. **Given** a provider for which no curated model list exists, **When** the administrator enters
   the provider's own model identifier, **Then** it is used verbatim and the conversation works.
5. **Given** an install whose saved model identifier is not in a curated list, **When** a message is
   sent, **Then** the identifier is still used verbatim — a curated list is a convenience, never an
   allow-list.
6. **Given** a provider with no credential, or one that is disabled, **When** a message is sent,
   **Then** the editor receives a plain configuration message naming the provider, and no credential
   material appears in the reply, the logs, or the interface.
7. **Given** a model that cannot accept image input, **When** the editor's message carries an image,
   **Then** the image bytes are withheld from the provider, the assistant says plainly that it
   cannot read file contents, and placing the file by name still works.
8. **Given** a provider returns an error and detailed errors are not enabled, **When** the editor
   sees the failure, **Then** the message is generic and nothing credential-shaped is echoed
   anywhere.

---

### User Story 2 - One mode, and no mode selector (Priority: P1)

The dropdown above the conversation list is gone. Every conversation is content editing. The
composer's guidance always speaks about approval, never about which mode is active. Conversations
created before this change still open, replay, and continue.

**Why this priority**: three modes tripled the surface that has to be reasoned about — the tool set,
the prompt, the guidance text, and every acceptance scenario — for a product whose job is one of
them. Removing the selector is what makes a single detailed, well-tested set of instructions (US3)
possible at all.

**Independent Test**: open the chat panel and confirm no mode control exists anywhere on it; open a
conversation created before this change, including one recorded under a mode that no longer exists,
and confirm it opens, replays its history, and accepts a new message.

**Acceptance Scenarios**:

1. **Given** the chat panel, **When** an editor looks at the conversation list and its header,
   **Then** there is no mode control, and no text refers to modes.
2. **Given** a new conversation, **When** the editor sends the first message, **Then** it is handled
   as content editing with no selection step.
3. **Given** a conversation stored under a mode that no longer exists, **When** the editor opens it,
   **Then** its full history replays and a follow-up message continues it normally.
4. **Given** a question about where a page's media or sections live, **When** the editor asks it in
   the only mode there is, **Then** the assistant can discover and answer without any mode switch.
5. **Given** an editor asks for a QA scan or a security audit, **When** the assistant responds,
   **Then** it states plainly that the capability is no longer offered — it is never silently
   missing, and no unreachable remnant of it is left in the product.

---

### User Story 3 - A detailed, versioned set of instructions (Priority: P2)

The assistant's instructions become explicit about the things it currently gets wrong by omission:
how to discover structure before proposing, how to handle a permission denial, when to ask instead
of guessing, how to talk about a proposal that has not been applied, and how to report what a tool
actually returned. The instructions carry a version, and each stored assistant turn records which
version produced it, so a transcript can be traced back to the rules in force at the time.

**Why this priority**: the current instructions are short enough that most of the assistant's
behaviour is improvisation, which is exactly the risk the request identifies — the model's logic
must be predictable. Detail is what makes it predictable. It depends on US2 only in that one mode
means one set of instructions to get right.

**Independent Test**: capture the composed instructions for a fixed set of request inputs twice and
confirm they are identical; read them and confirm they name no consuming project and hard-code no
field names; then run a scripted set of prompts (an ambiguous target, a denied permission, a request
that needs no change) and confirm each is handled the way the instructions say.

**Acceptance Scenarios**:

1. **Given** two requests with identical inputs, **When** the instructions are composed for each,
   **Then** they are byte-for-byte identical.
2. **Given** the instructions, **When** they are read end to end, **Then** they are in English, they
   name no specific customer project, and they assume no specific field names.
3. **Given** a tool reports the caller lacks a permission, **When** the assistant replies, **Then**
   it says so plainly, does not retry the same operation, and does not speculate about what it
   would have found or changed.
4. **Given** an instruction that could match several targets, **When** the assistant cannot resolve
   it, **Then** it lists the candidates and asks, rather than choosing.
5. **Given** a recorded proposal, **When** the assistant summarizes it, **Then** it states that
   nothing has changed yet and never claims the work is done, updated, or published.
6. **Given** the assistant concludes no change is needed, **When** it replies, **Then** it says so
   instead of proposing a cosmetic plan.
7. **Given** the instruction text is edited, **When** the change ships, **Then** its version
   identifier has changed and stored turns produced afterwards record the new version.

---

### User Story 4 - The prompt knows this project's structure (Priority: P2)

Before answering, the assistant is given a generated description of the install it is running in:
which content types exist, whether each is a single or collection type, whether it uses draft and
publish, which fields it has and of what type, which enumerations accept which values, which
relations point where, how components nest, which fields hold media, and which content types have a
preview target configured. It contains no content, no entry values, and no credentials. The same
install produces the same description on every request, and a maintainer can read the exact text
that was sent.

**Why this priority**: this is the "analyse the project" request, made safe for a plugin that ships
to many different projects. A hard-coded field map is wrong everywhere except the one project it was
written for — the previous version of this plugin shipped exactly that mistake. Deriving the
description at runtime is the only version that generalizes, and pinning it to be deterministic,
bounded, and inspectable is what keeps the model's behaviour predictable instead of drifting with
whatever the description happened to contain that day.

**Independent Test**: on one install, send the same request twice and confirm the description
embedded in the instructions is identical; add a content type and confirm the next request reflects
it with no restart; sign in as an account without read access to a content type and confirm that
type is absent from the description; open the settings inspector and confirm it shows exactly the
text that was sent.

**Acceptance Scenarios**:

1. **Given** an install with its own content types, **When** an editor asks which field holds a
   page's main image, **Then** the assistant answers with field names that exist in this install and
   invents none from elsewhere.
2. **Given** the same install, the same account, and an unchanged schema, **When** two requests are
   made, **Then** the embedded description is identical in both.
3. **Given** a new content type is added to the running project, **When** the next message is sent,
   **Then** the description includes it, with no restart.
4. **Given** an account that cannot read a particular content type, **When** it sends a message,
   **Then** that content type does not appear in the description.
5. **Given** a project large enough that the description would exceed its size budget, **When** it is
   composed, **Then** it is shortened the same way every time, is explicitly marked as partial, and
   instructs the assistant to discover the rest with tools.
6. **Given** any install, **When** the description is inspected, **Then** it contains no entry
   values, no media URLs, no user data, and nothing secret-like.
7. **Given** grounding is turned off in settings, **When** a message is sent, **Then** the assistant
   falls back to discovering structure with tools and nothing else about its behaviour changes.
8. **Given** an account allowed to read settings, **When** it opens the grounding inspector,
   **Then** it sees the exact description that requests are currently carrying.
9. **Given** the description lists a content type, **When** the assistant proposes a change to it,
   **Then** the caller's live permissions are still checked and can still block the item — the
   description authorizes nothing (FR-031, FR-037).

---

### User Story 5 - Copy what the assistant wrote (Priority: P3)

An editor copies an assistant reply — the whole message, or a single code block within it — with one
action, and gets clean Markdown they can paste into a document, a ticket, or an entry field.

**Why this priority**: the assistant is frequently asked to draft copy that then has to travel
somewhere else. Today that means selecting rendered Markdown by hand and losing its formatting.
Small, self-contained, and independent of everything else here.

**Independent Test**: send a message that returns formatted text including a list and a code block;
copy the message and confirm the pasted result is the Markdown source; copy the code block and
confirm only its contents arrive; reload the panel, reopen the thread, and confirm copying still
works on the restored messages.

**Acceptance Scenarios**:

1. **Given** an assistant reply containing formatted text, **When** the editor activates its copy
   control, **Then** the message's Markdown source is on the clipboard and a brief confirmation is
   shown.
2. **Given** a reply containing a code block, **When** the editor copies that block, **Then** only
   the block's contents are copied, without surrounding prose.
3. **Given** a reply that consists only of a structured card (a change plan or an apply report),
   **When** the editor looks for a copy control, **Then** either a readable plain-text rendering of
   the card is offered, or no control is offered at all — never a control that copies nothing.
4. **Given** the clipboard is unavailable or refused by the browser, **When** the editor tries to
   copy, **Then** an explicit failure message is shown rather than a silent no-op.
5. **Given** a keyboard-only or screen-reader user, **When** they reach the copy control, **Then**
   it is focusable, labelled in English, and operable without a pointer.
6. **Given** a conversation restored after a reload, **When** the editor copies one of its replies,
   **Then** it behaves the same as for a live one.

---

### User Story 6 - Approve and publish in one deliberate, clearly risky action (Priority: P3)

Alongside the existing approve actions, the plan card offers one that applies the approved items and
publishes each affected document. It is visually distinct, labelled as risky, and cannot fire from a
single click: a confirmation states that the result becomes publicly visible immediately. Every
publish is permission-checked against the caller's live permissions at the moment of application; a
document the caller may not publish comes back reported as blocked, never quietly skipped.

**Why this priority**: publication is not entirely absent today — the assistant can already include
a publish item in a plan, and approving it publishes. What is missing is an editor-initiated way to
take a reviewed plan live: publication happens today only when the assistant thought to propose it,
and approving it looks exactly like approving a draft edit, with no confirmation that distinguishes
"save a draft" from "make this publicly visible". This story makes going live a deliberate act the
editor chooses, with a warning proportionate to the consequence. It builds on the existing approval
and reporting flow, so it comes last.

**Independent Test**: with a plan holding two field changes on a draft-and-publish type, use the
risky action; confirm the confirmation is required, both fields are written, the document is
published, and the report says which items were published. Repeat as an account without publish
permission on the target and confirm the publish is reported blocked with a reason while the field
write still applies.

**Acceptance Scenarios**:

1. **Given** a pending plan and an account with publish permission on the target, **When** the editor
   uses the risky action and confirms, **Then** the approved items are applied, the affected
   documents are published, and the report states per item what was written and that it was
   published.
2. **Given** an account without publish permission on one of the targets, **When** the risky action
   runs, **Then** that publish is reported as blocked with the permission reason, the field write
   still applies where allowed, and no target is left in a half-published state without the editor
   being told.
3. **Given** a plan containing an item that removes content, **When** the editor uses the risky
   action, **Then** the existing separate confirmation for destructive items is still required in
   addition to the publish confirmation.
4. **Given** a target whose content type does not use draft and publish, **When** the risky action
   runs, **Then** the item is reported as live on save and no publish is attempted.
5. **Given** a document that was changed by someone else since the plan was generated, **When** the
   risky action runs, **Then** the conflicting item is neither applied nor published, and the editor
   is told the document moved on.
6. **Given** the risky action exists, **When** the editor wants to apply without publishing,
   **Then** the existing approve-all, approve-selected, and reject actions behave exactly as before.
7. **Given** the editor activates the risky action once and does not confirm, **When** they navigate
   away or dismiss it, **Then** nothing was applied and nothing was published.
8. **Given** the action's outcome, **When** the editor reloads the conversation, **Then** the same
   per-item report replays from the transcript.

---

### Edge Cases

- The adapter layer supports a provider whose runtime pieces are not shipped with the plugin: it must
  be absent from the selection rather than present and broken, and the reason must be stated where
  an administrator will see it.
- A provider is selectable but has no curated model list: the settings screen must still be usable,
  and a directly entered identifier must survive a save/reload round trip unchanged.
- A saved model identifier was removed from a curated list in a later release: the install must keep
  working on the identifier it holds.
- The active provider is configured but the deployment cannot reach it at all: the editor gets a
  configuration-shaped message before generation starts, not a truncated stream.
- A provider's streaming behaves differently — no incremental tool signalling, different stop
  semantics: the visible chat contract (progressive text, tool activity, working stop) must hold, or
  the difference must be stated in the interface rather than silently degrading.
- A provider needs a base URL as part of its own configuration (self-hosted or
  OpenAI-compatible): the URL is configuration, is validated, and is never rendered next to or
  confused with the credential.
- Stop is pressed mid-turn: server-side work must still end, the partial reply must still read as
  interrupted, and any change already approved during that turn must still be reported.
- An install has hundreds of content types and deeply nested components: the generated description
  must be shortened deterministically instead of crowding out the conversation, and the assistant
  must be told the description is partial.
- The schema changes between two turns of the same conversation: the newer description applies from
  the next request, and the assistant must not treat the earlier description as still true.
- A content type is visible to one account and not another: two accounts in the same install get
  different descriptions, and each is deterministic for that account.
- Grounding is switched off mid-conversation: the next turn simply discovers with tools; nothing in
  the stored history is invalidated.
- An account can read a content type but not update it: the description may list it, and the plan
  item for it must still come back blocked with a reason.
- Copy is attempted on a still-streaming reply: either the control is unavailable until the turn
  finishes, or it copies exactly what has arrived so far — but it never copies a partial value while
  presenting it as complete.
- The risky action is used on a plan that has already expired, or one already applied: it is refused
  with the same explanation as the existing approve actions.
- The risky action publishes a document whose required fields are empty and the host refuses the
  publish: the item is reported failed with the host's reason, and the field write's outcome is
  reported separately and accurately.
- The affected document already carries another editor's unreviewed draft edits: publication is
  document-scoped, so those edits go live too. The confirmation must say so before the editor
  commits (FR-045), because this is the one consequence of the action that is invisible in the
  plan's own before/after rows.
- A conversation stored before this change references a mode, a tool, or a report card that no longer
  exists: it replays without error and without implying the removed capability is still available.
- A consumer had granted the audit permission that this change removes: the upgrade must not fail,
  and the removal must be discoverable in the documentation rather than as a silent behaviour change.
- Two editors act on the same plan at the same time: one wins, the other is told the plan was already
  resolved.

## Requirements *(mandatory)*

### Functional Requirements

**Provider layer**

- **FR-001**: All language-model access MUST go through one provider-adapter layer. No chat, prompt,
  tool, approval, or interface path may branch on provider identity for core behaviour.
- **FR-002**: Provider breadth MUST be delegated to that adapter layer: every provider the layer
  supports and the distribution can carry MUST be usable by configuring it, with no plugin-side
  per-provider integration code. An administrator selects a supported provider and supplies its
  credential; they MUST NOT be able to introduce a provider the adapter layer does not know.
- **FR-003**: Where a curated model list exists for a provider, it MUST remain hard-coded in the
  repository's single source of truth, with every identifier verified against that provider's live
  catalog before it ships. Model lists MUST NOT be fetched from any provider catalog endpoint.
- **FR-004**: For a supported provider with no curated list, an administrator MUST be able to enter
  the provider's own model identifier directly, and it MUST be used verbatim.
- **FR-005**: A curated list MUST NOT act as an allow-list. A saved identifier that is not in the
  list MUST keep working unchanged.
- **FR-006**: Image input MUST be decided by a declared rule that defaults to deny. Image bytes MUST
  NEVER be sent to a model not declared able to accept them; attachment placement by filename MUST
  still work when they are withheld.
- **FR-007**: The active provider and model MUST be resolved from persisted configuration on every
  request, so a rotated credential or a changed model takes effect on the next message without a
  restart.
- **FR-008**: Provider credentials MUST remain encrypted at rest, write-only through every API
  surface, and masked on read. No error, log line, transcript, or interface state may echo credential
  material. Where a provider's configuration includes a base URL, that URL MUST be validated and
  MUST NOT be presented or stored in a way that conflates it with the credential.
- **FR-009**: The existing chat contract MUST be preserved: progressive streaming of the reply,
  visible tool activity as it happens, a user-initiated stop that releases server-side work,
  per-turn persistence of both sides of the exchange, and faithful replay of a restored conversation
  including plan cards and apply reports.
- **FR-010**: Configuration failures — no active provider, provider disabled, missing credential,
  unsupported provider — MUST surface as a plain message naming the provider before generation
  begins.
- **FR-011**: Consumers MUST continue to install the plugin with no additional dependencies and no
  build step. Provider coverage is therefore bounded by what the committed build output can carry; a
  provider the adapter layer supports but the distribution does not ship MUST be absent from the
  selection rather than offered and broken, and which providers ship MUST be documented.

**Single mode**

- **FR-012**: The assistant MUST have exactly one mode of operation, and the interface MUST expose no
  mode control anywhere.
- **FR-013**: Conversations stored before this change — including ones recorded under a mode that no
  longer exists — MUST open, replay their full history, and accept new messages.
- **FR-014**: The single mode's capabilities MUST include discovering the install's structure, so the
  assistant can locate media fields, sections, and slots without a mode switch.
- **FR-015**: No capability in this mode may write content. The assistant proposes; the editor
  approves; application happens through the existing approval path.
- **FR-016**: The read-only QA and security audit capabilities MUST be retired together with the mode
  that reached them, including their grantable permission action, their report surface, and their
  supporting services. No unreachable remnant may be left in the product, and the removal MUST be
  documented as a breaking change (FR-054).
- **FR-017**: No user-visible text may refer to modes, mode switching, or a mode's limitations.

**System prompt**

- **FR-018**: The instructions for a request MUST be composed from declared sections in a fixed
  order, and MUST be byte-for-byte identical for identical request inputs.
- **FR-019**: The composed instructions MUST carry a version identifier, and every stored assistant
  turn MUST record the version that produced it.
- **FR-020**: The instructions MUST name no consuming project and MUST hard-code no field names,
  content-type identifiers, or page structures.
- **FR-021**: The instructions MUST state explicitly that the assistant writes nothing itself, that
  approval belongs to the editor, that a permission denial is relayed plainly and never retried, that
  an ambiguous target is asked about rather than chosen, and that a proposal is never described as
  done, updated, or published.
- **FR-022**: The instructions MUST require one plan per request, containing every field the
  assistant intends to change, rather than several partial plans.
- **FR-023**: The existing attachment rules MUST be retained: a held file is referred to by its stable
  ordinal, never by a media-library identifier, and ingestion happens only on approval.
- **FR-024**: The instructions MUST require that a tool's result be reported as returned — including
  its limits — and MUST forbid inventing, extrapolating, or embellishing a result.
- **FR-025**: The instructions MUST be written in English, and every shipped user-facing string —
  interface labels, hints, error messages, and documentation — MUST be in English.
- **FR-026**: Any edit to the instruction text MUST change its version identifier in the same change.

**Project grounding**

- **FR-027**: The system MUST derive a structural description of the running install covering: each
  content type's identifier, kind, display name, draft-and-publish flag and localization; each
  field's name, type, required flag, accepted enumeration values, relation target and cardinality,
  and component reference with repeatability; component structures; which fields hold media; and
  which content types have a preview target configured.
- **FR-028**: The description MUST be derived only from the running instance's schema and the
  plugin's own configuration. It MUST NOT read, parse, or analyse the host application's source code.
- **FR-029**: The description MUST contain no entry values, no media URLs, no user data, and nothing
  secret-like.
- **FR-030**: The description MUST be deterministic: a fixed section order, a fixed sort for every
  list, no timestamps, no values that vary with content volume, and no involvement of a language
  model in producing it.
- **FR-031**: The description MUST be limited to what the calling account is allowed to read.
- **FR-032**: The description MUST have a declared size budget. When it would exceed it, it MUST be
  shortened by the same deterministic rule every time, MUST be explicitly marked as partial, and MUST
  instruct the assistant to discover the remainder with tools.
- **FR-033**: The description MUST be recomputed when the install's schema changes and reused
  otherwise, without requiring a restart.
- **FR-034**: The description MUST occupy a clearly delimited section of the instructions, marked as
  facts about this install, and MUST be explicitly subordinate to the behavioural instructions — a
  described structure never overrides a rule.
- **FR-035**: An account allowed to read the plugin settings MUST be able to inspect the exact
  description text that requests are carrying.
- **FR-036**: Grounding MUST be switchable off through configuration, with a safe default for an
  existing install. With it off, the assistant MUST fall back to tool-based discovery and nothing else
  about its behaviour may change.
- **FR-037**: The description MUST NOT authorize anything. Every read and every applied change MUST
  still be checked against the caller's live permissions.

**Copying output**

- **FR-038**: Each assistant message MUST offer a copy action that places that message's Markdown
  source on the clipboard.
- **FR-039**: Each code block within a reply MUST be individually copyable.
- **FR-040**: A copy MUST give brief visible confirmation on success and an explicit message on
  failure.
- **FR-041**: Copy controls MUST be reachable and operable by keyboard and MUST carry accessible
  labels.
- **FR-042**: Copy MUST work identically on a conversation restored after a reload.
- **FR-043**: A message with no copyable text MUST either offer a readable plain-text rendering of its
  structured content or offer no copy control at all — never a control that copies nothing.

**Approve & publish**

- **FR-044**: The plan card MUST offer an action that applies the approved items and publishes each
  affected document, visually distinct from the existing approve actions and labelled to signal its
  risk.
- **FR-045**: That action MUST require an explicit confirmation stating that the result becomes
  publicly visible immediately, and that publishing makes each affected document's entire current
  draft visible — not only the fields this plan reviewed, so any unreviewed draft edit already
  sitting on that document goes live with it. A single activation MUST NOT publish anything.
- **FR-046**: Each publish MUST be permission-checked per document against the caller's live
  permissions at the moment of application. A publish the caller may not perform MUST be reported as
  blocked with its reason, never skipped silently.
- **FR-047**: For a content type that does not use draft and publish, the item MUST be reported as
  live on save and no publish MUST be attempted.
- **FR-048**: The existing separate confirmation for items that remove content MUST still be
  required, in addition to the publish confirmation.
- **FR-049**: The existing conflict rules MUST hold unchanged: an item whose target moved on since the
  plan was generated is neither applied nor published, and the editor is told.
- **FR-050**: The outcome report MUST state, per item, what was written and whether it was published,
  and MUST persist into the transcript so a reload replays it.
- **FR-051**: The existing approve-all, approve-selected, and reject actions MUST remain and behave
  exactly as before.
- **FR-052**: A mixed outcome MUST be reported accurately as partially applied rather than as a
  success.

**Documentation and distribution**

- **FR-053**: The documentation MUST be updated in the same change for: which providers ship and how
  a provider is configured, the removal of the extra modes, the grounding setting and its default,
  and the new approval action.
- **FR-054**: Every removed permission action or removed capability MUST be documented as a breaking
  change, naming the version that removes it and what a consumer who granted it should do.

**Verification**

- **FR-055**: Every deterministic behaviour this feature requires — the byte-identical composition of
  the instructions (FR-018), the deterministic derivation and bounded degradation of the install
  description (FR-030, FR-032), the declared image-input rule (FR-006), and the configuration
  normalization and validation rules (FR-008, FR-036) — MUST be covered by automated tests that run
  as part of the pre-commit gate. Those tests MUST NOT call a language model, open a network
  connection, or depend on a running host application: they cover pure functions whose determinism is
  itself the requirement, so a failure is a defect and never a flake. Behaviour that only fails in
  integration — streaming, tool activity, stop, permission denials, replay, and the interface —
  remains verified manually in a running admin panel.

### Key Entities *(include if feature involves data)*

- **Supported provider**: one provider the adapter layer can reach and the distribution ships —
  identified for selection, carrying whatever configuration it needs (a credential, and a base URL
  where the provider requires one). The plugin describes providers; it does not implement them.
- **Curated model entry**: one selectable model for a provider that has a curated list — its
  provider-accepted identifier and a human-readable label, verified against the provider's live
  catalog before shipping. Never generated, normalized, or inferred.
- **Instruction set**: the composed system instructions for one request — an ordered set of declared
  sections plus a version identifier. Recorded against each stored assistant turn.
- **Install description**: the generated structural facts about the running project — content types,
  fields, enumerations, relations, components, media fields, preview targets — scoped to the calling
  account's read access, size-bounded, deterministic, and reused against a schema fingerprint.
- **Conversation and turn**: an owner-scoped conversation and its stored messages. The per-thread mode
  becomes unused; existing values are ignored rather than reinterpreted.
- **Change plan item**: unchanged in shape, extended in outcome — what was written, and whether the
  target was published, with a reason whenever either was refused.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An administrator can switch the active provider and receive a working reply on the next
  message in under one minute, with no restart and no redeployment.
- **SC-002**: At least one provider that this plugin did not support before the change is configured
  and answers a live message, with zero plugin-side integration code written for that provider.
- **SC-003**: 100% of conversations that existed before this change still open, replay their history,
  and accept a new message.
- **SC-004**: Across ten consecutive requests with identical inputs on an unchanged install, the
  composed instructions — including the install description — are identical every time.
- **SC-005**: Across a ten-question structural probe on a project the maintainer has never described
  to the assistant, the assistant names only fields that exist in that install: zero invented field
  names.
- **SC-006**: In the same probe, at least eight of ten questions are answered without the editor
  first having to supply a content-type identifier.
- **SC-007**: An editor can copy any assistant reply in one action and paste it with its formatting
  intact.
- **SC-008**: An editor can take a proposed change all the way to publicly visible content without
  leaving the chat panel, in at most two deliberate actions, one of which is a confirmation.
- **SC-009**: Across the full manual verification pass — every shipped provider, every error path, the
  grounding inspector, and the logs — there are zero occurrences of credential material.
- **SC-010**: The combined approve-and-publish action never publishes without its confirmation —
  zero occurrences across the verification pass — and 100% of publish attempts by an account
  lacking publish permission are reported as blocked with a reason. The pre-existing approve
  actions behave exactly as they did before the change.
- **SC-011**: The install description never exceeds its declared size budget, and a thirty-turn
  conversation on the largest available project still completes.
- **SC-012**: Every shipped user-facing string and the assistant's instructions are in English: zero
  non-English strings in the built output.

## Assumptions

- **Provider breadth belongs to the adapter layer.** Per the clarification above, the plugin does not
  curate which providers exist; it exposes what the layer supports. The plugin's remaining
  responsibility is configuration, credential handling, and the chat contract.
- **Distribution is the one real bound on that breadth**, and it is a constraint, not a narrowing of
  intent. The plugin ships as a git dependency with a committed build output and no consumer install
  step, so a provider is usable only if its runtime pieces can be carried there. How wide that set
  can be — bundling per-provider pieces, resolving them on demand, or covering the tail through a
  generic compatible-endpoint provider — is a planning question, and FR-011 requires that whatever
  is not shipped is absent rather than broken.
- **No model identifiers appear in this specification.** The repository's standing rule is that an
  identifier ships only after verification against the provider's live catalog in the session that
  ships it, and that the curated list has exactly one home. This spec points at that home rather than
  copying it.
- **Curated model lists stay for the providers that have them**, because a verified identifier in a
  dropdown is a better default than free text; providers without one accept a directly entered
  identifier (FR-004). Neither path fetches a catalog.
- **The audit capability is retired outright**, per the clarification above: the mode, the tools, the
  report surface, the services, and the grantable permission all go, as a documented breaking change.
- **Grounding is derived from schema and configuration only.** Source-code analysis was considered and
  rejected: it is not reproducible across the different projects this plugin ships to, its cost
  scales with the host repository rather than with the schema, and it would make the assistant's
  instructions depend on files the plugin has no contract with. Schema and plugin configuration are
  the only inputs the plugin can read consistently on every install.
- **Grounding is on by default**, because it is deterministic, size-bounded, permission-filtered, and
  inspectable. The switch exists for an install that wants strictly minimal instructions, and its
  default is safe for an existing install.
- **The description is deterministic per account, not merely per install.** Two accounts with
  different read access legitimately receive different descriptions; each is stable for that account
  and that schema.
- **Legacy per-thread mode values are ignored, not migrated.** Removing the stored value is not
  required for correctness, and leaving it untouched is the least destructive option for existing
  conversations.
- **Everything the previous features guaranteed still holds**: nothing is written without approval, a
  plan expires, previews are owner-scoped and expiring, attachments stay held in the browser until an
  approval ingests them, and permission checks are re-derived per request.
- **"Approve & Publish (Risky)" is the working label.** Final wording may be adjusted for clarity, but
  it must keep an explicit risk signal and must not read like the safe default.
- **Copying uses the browser clipboard**, which a browser may refuse; a refusal must be reported
  rather than swallowed (FR-040).
- **Verification is split by what can actually fail.** Deterministic pure logic is covered by
  automated tests, which this feature introduces (FR-055) — none of them calls a model, so none of
  them can flake on model output. Everything else is verified manually in a running admin panel: one
  live message per shipped provider whose path changed, plus one permission-denied path for the new
  publish action. Model *behaviour* is never asserted in a test; where it matters, the check is a
  human reading a real reply.

## Dependencies

- A running Strapi v5 host with its admin panel, whose schema and configuration are the sole source
  of the install description.
- The provider-adapter layer, which owns which providers exist and how each is reached. This feature
  depends on its provider coverage rather than reproducing it.
- A valid credential for each provider being verified; every provider whose path changes needs one
  live message before the change ships.
- The existing approval, preview, and attachment features (specification 001) and the curated model
  catalog (specification 002), both of which this feature builds on rather than replaces.
- The project constitution, whose provider-neutrality, permission, secret-handling, and
  self-contained-distribution rules constrain every requirement above.

## Out of Scope

- Fetching model catalogs from any provider endpoint.
- Reading or analysing the host application's source code, custom controllers, services, or lifecycle
  hooks.
- Introducing a provider the adapter layer does not support, or letting an administrator define one.
- Restoring layout mapping or code audit as selectable modes, or rebuilding the audit capability
  elsewhere in the panel.
- Any assistant capability that writes content without an editor's approval.
- Publication workflows beyond a single publish action — scheduling, staged releases, approval chains,
  or multi-locale publication policies.
- Shared or team-visible conversations; conversations remain private to their owner.
- Localizing the interface into any language other than English.
- Asserting a language model's *output* in an automated test, and any evaluation harness for model
  behaviour. The tests this feature adds (FR-055) cover deterministic pure logic only.
- End-to-end browser automation of the admin panel, and automated tests that boot a Strapi host.

## Constitution Alignment

Four principles are load-bearing here, and two apparent tensions are resolved rather than waived:

- **Principle III (provider neutrality)** requires that model lists stay curated and hard-coded and
  never be fetched from a provider endpoint. The request to stop hard-coding concerns the
  *per-provider integration code*, not the catalog. FR-002 removes the integration hard-coding;
  FR-003 keeps the catalog exactly where the constitution puts it, and FR-004 covers providers that
  have no curated list without introducing a fetch. These are not in conflict.
- **Principle IV (self-contained distribution)** means the provider layer ships inside the committed
  build output with no consumer install step. This is the real bound on "every provider the layer
  supports", and FR-011 makes it explicit and honest: unshipped providers are absent, not broken.
  Deciding how wide the shipped set can be is the first research task of the plan phase.
- **Principle II (per-caller permission checks)** governs both new surfaces: the install description
  is filtered per caller and authorizes nothing (FR-031, FR-037), and every publish in the new action
  is re-checked against the caller's live permissions at application time (FR-046).
- **Principle I (secrets)** extends to a new configuration value: where a provider needs a base URL,
  FR-008 keeps it validated and distinct from the credential, and SC-009 keeps the no-echo guarantee
  measured across every shipped provider.
- **Governance (complexity)** requires a new dependency to be justified against a concrete need in
  this specification. The justification is the maintainer's **explicit product decision**, recorded
  verbatim in the Input above and in the breadth clarification: language-model access moves to the
  adapter layer named in the request, and provider coverage becomes that layer's maintained surface
  instead of a branch in this repository's request path.

  It is **not** a capability gap, and this specification does not claim one. Planning research found
  that the existing SDK reaches the same provider breadth — one bundled package per provider plus a
  single configurable compatible endpoint for the tail — at no dependency cost. The dependency
  proceeds because the maintainer chose the layer after being shown that finding; the trade is on
  the record in the plan's Complexity Tracking table rather than dressed up as a requirement only
  one library can satisfy. FR-001, FR-002 and FR-011 stay written against "the provider-adapter
  layer", so they remain verifiable against behaviour whichever layer is in place.
