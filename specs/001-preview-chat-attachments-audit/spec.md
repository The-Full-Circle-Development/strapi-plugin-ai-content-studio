# Feature Specification: Preview, Persistent Chat, Deferred Attachments & Audit Modes

**Feature Branch**: `main` (this repository commits directly to `main`; spec directory is `specs/001-preview-chat-attachments-audit`)

**Created**: 2026-08-07

**Status**: Draft

**Input**: User description: "Strapi AI Content Management Plugin — (1) Live Preview & Execution Plan: pre-save preview of AI-generated content changes on the website front-end before persisting or publishing, plus a dry-run change plan. (2) Chat Persistence & Session Management: per-user chat storage, conversational context within a thread, ability to abort active streaming, mode selection (Content Editing, Layout Mapping, Code Audit). (3) Attachment Processing & Deferred Media Ingestion: contextual analysis of uploaded files to fulfil layout instructions, support for any file type the Media Library allows, and deferred upload — attachments are held in temporary memory and only ingested into the Media Library when explicitly requested. (4) Functional QA & Security Vulnerability Scanning: detect runtime errors, broken references and edge-case bugs in content models, custom logic and component integrations; audit plugin functionality and API configuration for vulnerabilities, permission leaks and unsafe data handling."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Approve a change plan before anything is written (Priority: P1)

An editor asks the assistant to make a content change ("update the homepage hero headline and swap the button label"). Instead of writing immediately, the assistant presents a plan: each target document, each field, the current value, the proposed value, and whether the result will be a draft or published. Nothing has been written yet. The editor approves the whole plan, approves only some items, or rejects it. Only on approval does the content change, and the assistant then reports exactly what was applied.

**Why this priority**: This is the safety foundation everything else builds on. Today the assistant writes as soon as it decides to, so a misread instruction lands straight in the database. A reviewable plan turns every edit into a deliberate act and produces the pending change set that live preview (US2) renders. It is independently valuable even with no other story shipped.

**Independent Test**: In a running admin panel, ask for a multi-field edit. Verify the entry is unchanged in the Content Manager while the plan is displayed, that rejecting leaves it unchanged, and that approving applies exactly the listed fields and nothing else.

**Acceptance Scenarios**:

1. **Given** an editor with update permission on a content type, **When** they ask the assistant to change two fields on one document, **Then** a plan listing both fields with current and proposed values is shown, no data has changed, and the plan offers approve / approve-selected / reject.
2. **Given** a displayed plan, **When** the editor rejects it, **Then** no document is modified, no media is uploaded, and the assistant confirms nothing was applied.
3. **Given** a displayed plan, **When** the editor approves it, **Then** every listed change is applied, the assistant reports each field's old and new value plus draft/published state, and any item that failed is reported as failed with a reason.
4. **Given** a plan whose items span several documents, **When** the editor approves only some items, **Then** only those items are applied and the unapproved items are discarded.
5. **Given** an editor who lacks update permission on a targeted content type, **When** the plan is generated, **Then** that item is shown as blocked with a permission reason and cannot be approved.
6. **Given** an approved plan, **When** the underlying document has been changed by someone else since the plan was generated, **Then** the conflicting item is not silently overwritten; the editor is told the document moved on and asked to re-plan.

---

### User Story 2 - See pending changes on the real site before saving (Priority: P2)

Before approving, the editor opens a preview of the proposed result rendered by the actual website front-end — the hero with the new headline, the new image in place — while the database still holds the old content. The preview is visible only to that editor, expires on its own, and never appears on the public site. From the preview the editor can go back and approve or reject.

**Why this priority**: Wording and media choices are judged visually, not as a field diff. Previewing on the real front-end is what makes "approve" a confident click rather than a guess. It depends on the pending change set from US1, so it follows it.

**Independent Test**: With a pending change set that alters a text field and a media field, open the preview and confirm the front-end renders the proposed values; confirm an anonymous visitor to the same page still sees the old content; confirm the preview stops working after it expires.

**Acceptance Scenarios**:

1. **Given** a pending change set on a previewable page, **When** the editor opens the preview, **Then** the front-end renders the proposed values while the stored document is unchanged.
2. **Given** an open preview, **When** an unauthenticated visitor loads the same page, **Then** they see the currently published content with no trace of the pending change.
3. **Given** a preview link, **When** its lifetime has elapsed, **Then** the link no longer resolves and the editor is told the preview expired and can be regenerated.
4. **Given** a project with no front-end preview target configured, **When** the editor asks to preview, **Then** the plugin explains that no preview target is configured and falls back to a field-level before/after comparison in the panel, without blocking approval.
5. **Given** a pending change set that includes a not-yet-ingested attachment, **When** the preview is opened, **Then** the image is rendered from the pending attachment so the editor sees the real composition, and the Media Library still contains no new file.
6. **Given** a preview is open, **When** the editor rejects the plan, **Then** the preview is invalidated immediately.

---

### User Story 3 - Conversations persist per user and survive reloads (Priority: P3)

Each admin user has their own conversation list. Threads persist across page reloads, restarts, and logins. Opening an old thread restores its full message history — user messages, assistant replies, the tool steps and change plans that were part of it — and continuing the thread keeps that context, so "now do the same for the About page" still works. A user can rename and delete their own threads. No user, including a super-admin, can read another user's threads through the plugin.

**Why this priority**: Loss of history on reload is the most common daily frustration and blocks any multi-session task. It is independent of preview and audit work, but ranks below the write-safety stories.

**Independent Test**: Start a thread, reload the panel, confirm the thread and its messages are intact and that a follow-up referring to earlier context is answered correctly. Log in as a second admin and confirm the first user's threads are not listed or reachable.

**Acceptance Scenarios**:

1. **Given** an editor with an active conversation, **When** they reload the admin panel, **Then** the conversation appears in their thread list and opens with its complete message history in order.
2. **Given** a restored thread, **When** the editor sends a follow-up that depends on an earlier message, **Then** the assistant answers using that earlier context.
3. **Given** two admin users each with threads, **When** either lists or opens threads, **Then** only their own threads are listed, and a direct request for another user's thread is refused.
4. **Given** a thread, **When** the editor renames it, **Then** the new name persists; **When** they delete it, **Then** it disappears from their list and its messages are no longer retrievable.
5. **Given** a new thread, **When** the first exchange completes, **Then** the thread is automatically given a short descriptive title the user can override.
6. **Given** a very long thread, **When** the editor continues it, **Then** the assistant still responds within normal time and the conversation remains coherent, with older context condensed rather than the request failing.

---

### User Story 4 - Stop a generation that is going the wrong way (Priority: P4)

While the assistant is streaming a reply or working through tool steps, the editor presses Stop. Output halts immediately, no further tool step runs, and no content change is applied from that turn. The partial reply stays in the thread marked as interrupted, and the editor can send a new message right away.

**Why this priority**: A cheap, high-relief control that also limits the damage of a misunderstood instruction. Small in scope, so it sits below the persistence work it is stored alongside.

**Independent Test**: Ask for a long multi-step task, press Stop mid-stream, and confirm output stops, that no additional write occurs after the press, and that the thread remains usable.

**Acceptance Scenarios**:

1. **Given** a streaming reply, **When** the editor presses Stop, **Then** visible output stops promptly and the composer becomes ready for a new message.
2. **Given** the assistant is between tool steps, **When** the editor presses Stop, **Then** no further tool step begins and no additional content change is applied.
3. **Given** a stopped generation, **When** the thread is reloaded later, **Then** the partial assistant message is present and clearly marked as interrupted.
4. **Given** a stop during a turn that had already applied an approved change, **When** the turn ends, **Then** the assistant reports which changes were applied before the stop.

---

### User Story 5 - Choose the mode that matches the task (Priority: P5)

The editor picks a mode for the conversation: **Content Editing** (default — full content work within their permissions), **Layout Mapping** (assigning media and arranging page sections/components), or **Code Audit** (read-only inspection: QA and security findings, no writes). The current mode is visible, is remembered per thread, and constrains what the assistant can do — in Code Audit mode no content change is possible at all.

**Why this priority**: Modes make the audit stories usable safely and reduce misfires in editing work, but every mode's underlying capability can ship before the selector exists.

**Independent Test**: Switch a thread to Code Audit, ask for a content change, and confirm the assistant explains that writes are unavailable in this mode and makes none. Reopen the thread later and confirm the mode is still Code Audit.

**Acceptance Scenarios**:

1. **Given** the mode selector, **When** the editor picks a mode, **Then** the choice is shown in the thread and persists with that thread across reloads.
2. **Given** Code Audit mode, **When** the editor requests a content change, **Then** no change is made and the assistant states that this mode is read-only and how to switch.
3. **Given** Layout Mapping mode, **When** the editor asks which sections of a page accept images, **Then** the assistant reports the page's sections and their media slots.
4. **Given** a new thread, **When** it is created, **Then** it starts in Content Editing mode.
5. **Given** a mode change mid-thread, **When** the next message is sent, **Then** the new mode governs that message and the earlier history remains readable.

---

### User Story 6 - Attach files, place them, and only ingest on request (Priority: P6)

The editor attaches several files to a message — two photos and a PDF — and writes "image #1 to the Hero, image #2 to the Info section, link the PDF on the downloads block". The attachments are held for the conversation and are **not** in the Media Library. The assistant reads the instruction, confirms which file goes where, and includes the uploads in the change plan. Only when the editor approves (or explicitly asks to upload) do the files enter the Media Library and get attached to fields. If the editor never approves, nothing is ingested and the Media Library stays clean.

**Why this priority**: This corrects a real current behaviour — attachments are ingested on send today, littering the library with files from abandoned conversations — and unlocks layout work. It depends on the plan/approval flow to define the moment of ingestion.

**Independent Test**: Attach two images and a PDF, describe per-file placement, and confirm: the Media Library gains nothing while the plan is pending; the plan names the correct file for each target; approving ingests exactly those files once and links them; rejecting ingests nothing.

**Acceptance Scenarios**:

1. **Given** an editor attaches files and sends a message, **When** the assistant replies, **Then** the Media Library contains no new files and the attachments are listed in the message with stable ordinal labels (#1, #2, …) and their names.
2. **Given** a message with per-file placement instructions, **When** the plan is generated, **Then** each attachment is mapped to the target field the instruction named, and any instruction the assistant could not map is called out as unresolved rather than guessed.
3. **Given** an approved plan containing attachment ingestion, **When** it is applied, **Then** each file is added to the Media Library exactly once and linked to its target field, and the assistant reports the resulting library entries.
4. **Given** a file type or size the host's Media Library rules reject, **When** the editor attaches it, **Then** they are told before sending, with the reason, and the file is not attached.
5. **Given** the active model cannot interpret images, **When** an image is attached, **Then** the assistant says it cannot analyse the image visually but can still place it where instructed, and placement still works.
6. **Given** attachments held for a conversation, **When** the editor reloads the panel before approving, **Then** the restored thread shows those attachments as expired, explains they were never ingested, and invites re-attaching.
7. **Given** a request to "upload these to the media library" with no content change, **When** the editor confirms, **Then** the files are ingested and reported with their library ids, and no document is modified.

---

### User Story 7 - Find functional defects in the content setup (Priority: P7)

In Code Audit mode the editor (or maintainer) asks for a QA pass. The assistant inspects content models, components, relations and media references and reports concrete problems: required fields that are empty on existing entries, relations pointing at deleted documents, media fields referencing missing files, components used in ways that will fail to render, enumerations with values outside their allowed set, and single types never created. Each finding has a location, severity, why it breaks, and a suggested fix. Nothing is changed.

**Why this priority**: High value and fully read-only, but it is diagnostic rather than blocking, so it ranks after the editing and attachment work.

**Independent Test**: Seed a project with known defects (a broken relation, a missing media reference, an empty required field), run the QA pass, and confirm each seeded defect is reported with its location and a plausible fix, and that no data changed.

**Acceptance Scenarios**:

1. **Given** a project with a relation pointing at a deleted document, **When** a QA pass runs, **Then** the finding names the content type, document, and field, and explains the breakage.
2. **Given** a QA pass, **When** it completes, **Then** findings are grouped by severity with counts, and the report states which areas were inspected and which were skipped.
3. **Given** a QA pass, **When** it completes, **Then** no content, configuration, or media has been modified.
4. **Given** an editor whose permissions cover only some content types, **When** they run a QA pass, **Then** only the content types they may read are inspected and the report says which were skipped for permissions.
5. **Given** a clean project, **When** a QA pass runs, **Then** it reports no findings rather than inventing them.
6. **Given** a project too large to inspect exhaustively within the time budget, **When** the pass ends, **Then** the report states explicitly what was not covered.

---

### User Story 8 - Audit the plugin and API surface for security problems (Priority: P8)

A super-admin asks for a security review. The assistant inspects the plugin's own configuration and the project's API-facing configuration and reports: content types exposed publicly that probably should not be, roles granted broader permissions than their purpose suggests, endpoints reachable without authentication, fields containing secret-like values, upload rules that accept dangerous file types, and plugin settings left in a debug-friendly state. Each finding has severity, evidence, impact, and a remediation step. The report is available only to users holding the audit permission, and it never echoes a secret value.

**Why this priority**: Important but the most sensitive and the least frequently used; it also depends on mode selection and the audit reporting shape established in US7.

**Independent Test**: As a super-admin, run the audit on a project with a deliberately over-permissive public role and a debug flag enabled, and confirm both are reported with remediation. As an editor without the audit permission, confirm the audit is refused and no findings leak.

**Acceptance Scenarios**:

1. **Given** a public role granted write access to a content type, **When** the audit runs, **Then** it is reported as a high-severity finding with the exact role, content type, and action, and a remediation step.
2. **Given** a project with verbose provider error details enabled, **When** the audit runs, **Then** it is reported as a configuration risk for production.
3. **Given** any audit report, **When** it mentions a credential or key-like value, **Then** only a masked form appears — never the value.
4. **Given** an admin without the audit permission, **When** they request a security audit, **Then** it is refused with a clear reason and no partial findings are shown.
5. **Given** an audit run, **When** it completes, **Then** nothing has been changed; every remediation is advice, not an applied fix.
6. **Given** findings whose remediation the user then asks to apply, **When** the request is made, **Then** it is routed through the normal change plan and permission checks rather than applied by the audit itself.

---

### Edge Cases

- **Plan goes stale**: the target document changes between plan generation and approval — the affected item is refused and re-planning is offered instead of overwriting.
- **Permission revoked mid-flight**: an editor's permission is removed after the plan is shown; approval re-checks permissions at apply time and blocks the item.
- **Partial apply failure**: item 3 of 5 fails — items 1–2 stay applied, 4–5 are attempted or skipped per their independence, and the report states precisely which succeeded and which did not.
- **Preview target missing or unreachable**: no preview URL configured, or the front-end is down — the panel says so and falls back to the field-level comparison.
- **Preview link shared**: a preview link is opened by a different user or after expiry — it does not resolve.
- **Empty plan**: the assistant concludes no change is needed — it says so instead of showing an empty plan.
- **Destructive plan**: a plan would clear a field or delete content — the destructive items are visually distinguished and require explicit confirmation.
- **Concurrent generations**: the same user sends a message in two browser tabs of the same thread — the thread stays consistent and neither reply is lost or interleaved.
- **Stop during apply**: Stop is pressed while an approved plan is being applied — in-flight items complete or roll back cleanly, no item is left half-written, and the outcome is reported.
- **Storage growth**: history and pending change sets accumulate — expired previews and pending sets are cleaned up automatically and thread growth stays bounded by retention rules.
- **Thread from a removed content type**: a stored thread references a content type that no longer exists — history still renders and the assistant explains the reference is gone.
- **Attachment held too long / oversized set**: attachments exceed the held-size budget or the conversation ends — they are dropped with a clear message, never silently ingested.
- **Duplicate ingestion**: the same plan is approved twice, or the user retries after a network error — the file is not ingested twice.
- **Ambiguous placement**: "put this image in the hero" where the page has several hero-like slots — the assistant asks rather than choosing.
- **Non-visual attachment**: a PDF or archive is attached to a vision-only flow — it is still usable for placement and linking based on its name and type.
- **Audit on a huge project**: coverage is capped by the time budget — what was skipped is stated explicitly rather than presented as a clean bill of health.
- **Audit finds a secret in content**: reported as masked, with the location, and never reproduced in full.
- **Mode mismatch**: a mode-restricted capability is requested — refused with the reason and the way to switch, never silently performed.
- **Provider without a needed capability**: the selected model lacks image understanding or long context — the affected capability degrades with an explicit message and the rest of the chat keeps working.

## Requirements *(mandatory)*

### Functional Requirements

**Change plan and approval (US1)**

- **FR-001**: The assistant MUST NOT modify content, publish content, or ingest media except by applying a change set the user has explicitly approved in the current thread.
- **FR-002**: The system MUST present, for every proposed modification, the target content type, the target document's identity and title, the field, the current value, the proposed value, and the resulting draft/published state.
- **FR-003**: The system MUST let the user approve the whole plan, approve a chosen subset of items, or reject the plan; rejection MUST leave all content, configuration, and media untouched.
- **FR-004**: The system MUST re-check the caller's permission for each item at apply time and block items the caller may not perform, reporting the reason.
- **FR-005**: The system MUST detect that a target document changed after the plan was generated and refuse to overwrite it, offering re-planning instead.
- **FR-006**: The system MUST report, after applying, each item's outcome — applied with old and new value, blocked with reason, or failed with reason.
- **FR-007**: The system MUST mark items that clear a field, remove a relation, or delete content as destructive and require explicit confirmation distinct from ordinary approval.
- **FR-008**: The system MUST record the approving user, the time, and the applied items on the thread so the exchange remains auditable in the history.
- **FR-009**: Pending change sets MUST expire without being applied and MUST be discarded when the user rejects them, sends an unrelated new instruction, or lets them expire.

**Live preview (US2)**

- **FR-010**: The system MUST let the user open a preview in which the website front-end renders the pending change set's proposed values while stored content remains unchanged.
- **FR-011**: A preview MUST be viewable only by the admin user who created it, and MUST NOT be reachable by anonymous visitors or by other users.
- **FR-012**: A preview MUST expire automatically after a bounded lifetime and MUST be invalidated when the pending change set is applied, rejected, or expires.
- **FR-013**: Media referenced by a pending change set MUST render in the preview without being added to the Media Library.
- **FR-014**: When no preview target is configured or the front-end cannot be reached, the system MUST say so and provide a field-level before/after comparison in the panel, without blocking approval.
- **FR-015**: Opening a preview MUST NOT write, publish, or queue any content change.

**Chat persistence (US3)**

- **FR-016**: The system MUST persist each conversation — messages, ordering, timestamps, tool steps, plans, and outcomes — so it survives reloads, logouts, and server restarts.
- **FR-017**: Conversations MUST be owned by the admin user who created them; listing, reading, renaming, and deleting MUST be restricted to the owner, and requests for another user's conversation MUST be refused regardless of the requester's role.
- **FR-018**: The system MUST list a user's conversations most-recent-first with a title and last-activity time, and MUST let the user open, rename, and delete them.
- **FR-019**: The system MUST give a new conversation an automatic short title derived from its first exchange, which the user can override.
- **FR-020**: Continuing a conversation MUST supply prior messages of that thread as context so multi-turn references resolve, and MUST NOT mix context across threads or users.
- **FR-021**: When a thread's history exceeds what the active model can accept, the system MUST condense older context rather than fail the request, and MUST tell the user that earlier detail was condensed.
- **FR-022**: Deleting a conversation MUST remove its messages and any pending change sets, previews, and held attachments belonging to it.

**Generation control (US4)**

- **FR-023**: The user MUST be able to stop an in-progress generation, and stopping MUST halt output and prevent any further tool step or content change from that turn.
- **FR-024**: A stopped turn MUST persist its partial assistant output marked as interrupted, and MUST leave the thread immediately usable for a new message.
- **FR-025**: Stopping MUST release the server-side work for that turn rather than letting it run to completion unobserved.
- **FR-026**: If changes were already applied earlier in a stopped turn, the system MUST report which ones were applied.

**Modes (US5)**

- **FR-027**: The system MUST offer selectable modes — Content Editing, Layout Mapping, and Code Audit — with Content Editing as the default for new conversations.
- **FR-028**: The active mode MUST be visible in the conversation and persist with the conversation.
- **FR-029**: Code Audit mode MUST expose no content-modifying capability at all; a change request in that mode MUST be refused with the reason and the way to switch.
- **FR-030**: Layout Mapping mode MUST be able to report a page's sections/components and their media and link slots to support placement instructions.
- **FR-031**: A mode MUST NOT grant any capability the caller's permissions do not already allow; modes only narrow, never widen.

**Attachments and deferred ingestion (US6)**

- **FR-032**: The composer MUST accept any file type and size the host project's Media Library rules allow, and MUST reject anything outside them before the message is sent, stating the reason.
- **FR-033**: Attachments MUST be held for the conversation only and MUST NOT be added to the Media Library until the user explicitly requests ingestion or approves a change set that includes it.
- **FR-034**: Each attachment MUST carry a stable ordinal label and its filename within the message so instructions like "image #1 to the Hero" resolve unambiguously.
- **FR-035**: The assistant MUST map each attachment to the field or slot the user's instruction names, and MUST report any attachment or instruction it could not map instead of guessing.
- **FR-036**: When the active model cannot interpret an attachment's content, the assistant MUST still support placement and linking using the attachment's name, type, and the user's instructions, and MUST state that it cannot analyse the content.
- **FR-037**: Ingestion MUST add each approved file to the Media Library exactly once even if approval is retried, and MUST report the resulting library entries.
- **FR-038**: Held attachments MUST be discarded when the conversation is abandoned, reloaded, or exceeds the held-size budget, and the user MUST be told they were never ingested and can re-attach.
- **FR-039**: A user MUST be able to ask for attachments to be ingested into the Media Library with no content change, and that ingestion MUST be confirmed before it happens.

**Functional QA scanning (US7)**

- **FR-040**: The system MUST inspect, on request, content models, components, relations, media references, and existing entries and report defects including: empty required fields, relations pointing at missing documents, media fields referencing missing files, values outside an enumeration's allowed set, component usage that will fail to render, and single types never created.
- **FR-041**: Every finding MUST state its location (content type, document, field), a severity, why it is a problem, and a suggested fix.
- **FR-042**: A QA pass MUST be strictly read-only — no content, configuration, or media may change.
- **FR-043**: A QA pass MUST inspect only what the calling user is permitted to read, and MUST list what was skipped for permissions.
- **FR-044**: A QA pass MUST state its coverage — what was inspected and what was not — and MUST NOT present a partial pass as complete.
- **FR-045**: A QA pass over a clean project MUST report no findings rather than speculative ones.

**Security auditing (US8)**

- **FR-046**: The system MUST inspect, on request, the plugin's configuration and the project's API-facing configuration and report at least these checkable conditions: content types or endpoints reachable without authentication; create, update, delete, or publish permissions granted to the public/unauthenticated role; a role granted permissions on content types outside its stated purpose; upload rules that accept executable or script file types; debug or verbose-error settings that are unsafe in production; and secret-like values stored in content fields or configuration.
- **FR-047**: Each security finding MUST state severity, the evidence, the impact, and a concrete remediation step.
- **FR-048**: Security audit findings MUST be available only to users holding the audit permission; requests without it MUST be refused with no partial findings disclosed.
- **FR-049**: Audit output MUST never reproduce a credential, key, or token value; such values MUST appear masked, with their location.
- **FR-050**: A security audit MUST be strictly read-only; applying any remediation MUST go through the normal change plan and permission checks.

**Cross-cutting**

- **FR-051**: Every new capability MUST be gated by the caller's existing permissions, and MUST NOT let a user do anything they could not do directly in the admin panel.
- **FR-052**: A capability the active provider or model cannot support MUST degrade with an explicit message and MUST NOT break the rest of the conversation.
- **FR-053**: All new user-facing surfaces MUST report failures as actionable messages that never expose credentials or raw internal errors.
- **FR-054**: New configuration options MUST have safe defaults so an existing installation keeps working unchanged after upgrade, and the documented install/permission/configuration steps MUST be updated with the change.

### Key Entities *(include if feature involves data)*

- **Conversation (Thread)**: one chat session owned by exactly one admin user. Holds a title, active mode, creation and last-activity times, and an ordered list of messages. Never visible to another user.
- **Message**: one turn in a conversation — its author (user or assistant), content, attachment references, tool steps, and an interrupted flag for stopped generations.
- **Mode**: the conversation's operating mode (Content Editing, Layout Mapping, Code Audit) determining which capabilities are offered; narrows the caller's permissions, never widens them.
- **Pending Change Set (Change Plan)**: a proposal produced by the assistant and not yet applied. Belongs to a conversation, has a creation time, an expiry, a status (pending, applied, rejected, expired), and a list of change items.
- **Change Item**: one proposed modification — target content type, target document, field, current value, proposed value, resulting draft/published state, destructive flag, permission verdict, and post-apply outcome.
- **Preview Session**: a short-lived, owner-only view of a pending change set as rendered by the front-end. Has an expiry and is invalidated when its change set resolves.
- **Held Attachment**: a file attached to a conversation and not yet ingested. Has an ordinal label, filename, declared type, size, validation verdict, and an ingestion state (held, ingested, discarded).
- **Media Reference**: the Media Library entry created when a held attachment is ingested, linked to the change item that requested it.
- **Audit Report**: the result of a QA or security pass — the kind of pass, who ran it, when, the coverage statement, and its findings.
- **Audit Finding**: one reported problem — category, severity, location, evidence (masked where sensitive), impact, and suggested remediation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Across a verification session covering at least 10 change requests, zero content modifications, publishes, or Media Library additions occur without an explicit user approval recorded in the thread.
- **SC-002**: After a plan is shown, an editor can judge and approve or reject it — including a look at the rendered preview — in under 60 seconds without leaving the admin panel.
- **SC-003**: 100% of applied changes are reported back with the field, old value, new value, and draft/published state; every blocked or failed item is reported with a reason.
- **SC-004**: Pending changes are visible on the front-end preview to their owner and to no one else: in testing with a second admin account and an anonymous visitor, 0 previews leak.
- **SC-005**: After a reload or restart, a returning user's conversation list and the full history of any thread they open are restored intact, within 5 seconds of opening the panel.
- **SC-006**: In cross-account testing with at least 2 users and 2 roles, 0 conversations, held attachments, or pending change sets are readable by anyone other than their owner.
- **SC-007**: Pressing Stop halts visible output within 2 seconds, and 0 content changes are applied from that turn after the press.
- **SC-008**: In Code Audit mode, 100% of content-change requests are refused with an explanation and produce no modification.
- **SC-009**: Across a session with attachments in which the user never approves ingestion, the Media Library gains 0 files; when the user does approve, each file appears exactly once.
- **SC-010**: For messages containing per-file placement instructions, the correct file is mapped to the correct target in at least 9 of 10 trials, with unmappable instructions flagged rather than guessed.
- **SC-011**: A QA pass over a project seeded with 10 known defects reports at least 9 of them with a correct location and a plausible fix, with no more than 1 false positive per 10 findings.
- **SC-012**: A QA or security pass over a project of up to 50 content types completes within 2 minutes and states its coverage, including anything skipped.
- **SC-013**: Requests for security audit output from users without the audit permission are refused 100% of the time, with no partial findings disclosed.
- **SC-014**: No audit report, error message, or log line produced by this feature contains an unmasked credential, key, or token, verified by review of the outputs of a full verification session.
- **SC-015**: Corrective follow-up edits — a change applied then immediately re-edited to fix wording or the wrong image — drop by at least 50% compared with the same tasks performed without the plan and preview.
- **SC-016**: An existing installation upgraded to this version keeps working with no new required configuration, and every capability the active provider cannot support states so instead of failing the conversation.

## Assumptions

Decisions taken where the description left a choice open. The three marked **D1–D3** change the shape of the work most and are the first candidates to revisit in `/speckit-clarify`.

- **D1 — Preview does not persist content.** Preview renders a pending change set that lives outside the content tables, so "before persisting to the database" is honoured literally: nothing is written until approval. The front-end is expected to be able to render a preview of supplied content for an authenticated preview session; where the project has no such preview target, the panel falls back to a field-level before/after comparison (FR-014). The alternative reading — write a draft first and preview the draft — was rejected because it persists content before approval.
- **D2 — Audits inspect the running configuration, not project source files.** "Content models, custom logic, and component integrations" is scoped to what the running application exposes: content-type and component definitions, relations and media references, role permissions, route and endpoint configuration, plugin settings, and existing content data. Reading the host project's source files from disk is **out of scope** for this feature, because an admin-panel chat that can read arbitrary project files is a far larger attack surface than the feature needs.
- **D3 — Security findings are permission-gated; QA findings are not.** Functional QA is available to any user with chat access, limited to content they may read. Security audit output is restricted to holders of a dedicated audit permission (super-admin by default), because a list of permission leaks and weak configuration is itself sensitive.
- Held attachments live only for the current browsing session of a conversation; a reload loses them by design, and the restored thread says so (FR-038). Making them survive a reload would mean storing unapproved user files server-side, which the deferred-ingestion requirement is meant to avoid.
- **Default bounds** (configurable, chosen so the requirements are testable): a pending change set expires 30 minutes after it is generated (FR-009); a preview session expires 30 minutes after it is opened (FR-012); held attachments are bounded by the host's per-file Media Library size limit per file and 50 MB in total per conversation (FR-038); a QA or security pass is bounded by a 2-minute time budget, after which it reports its partial coverage (FR-044, SC-012).
- "Automatically scan" means the assistant determines its own inspection targets and runs the pass without the user enumerating them; it does **not** mean scheduled or background scanning. No cron or unattended scanning is in scope.
- Conversation history is retained until the owning user deletes it, or the owning admin account is removed, at which point their conversations and held data are removed with it. No fixed expiry is imposed.
- Existing behaviour is reused rather than replaced: the current chat surface, provider/model selection, per-caller permission checks on content operations, and the Media Library remain the mechanisms this feature builds on. This feature changes when media is ingested, not how.
- Modes constrain the assistant's offered capabilities only; the caller's permissions remain the outer boundary in every mode.
- The existing settings surface (provider, model, keys) stays super-admin only and is not extended by this feature beyond any safe-defaulted options it needs.
- Verification is manual in a running admin panel, including at least one permission-denied path per new capability, consistent with this project's quality gate.
- Preview requires a front-end that cooperates with an authenticated preview request; projects whose front-end cannot do this get the fallback comparison and lose no other functionality.
