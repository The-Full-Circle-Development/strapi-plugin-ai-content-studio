# Feature Specification: Model Catalog Refresh & Freshness Guardrails

**Feature Branch**: `main` (project rule: all work commits directly to `main`; no feature branches)

**Created**: 2026-08-09

**Status**: Draft

**Input**: User description: refresh the curated per-provider model list, add a standing guardrail so model IDs are never written from memory, amend the constitution so a live refresh may augment the curated floor, evaluate live model discovery from provider catalogs, and update docs + build.

## Overview

The plugin ships a curated, hardcoded list of selectable models per provider. That list has drifted:
it advertises models that are superseded and omits every current-generation model from all three
providers. An administrator opening Settings today cannot pick the models they actually pay for.

This feature does four things, in descending order of certainty:

1. Brings the catalog current (and the default model with it).
2. Installs a standing guardrail so the catalog cannot silently rot again — model identifiers must be
   verified against the provider's live catalog before they ship, and that rule must be present at
   the start of every working session rather than remembered.
3. Amends project governance so the curated list is defined as a **floor and fallback** rather than a
   prohibition on ever consulting a provider's own catalog.
4. Optionally adds a live refresh that augments the curated floor with the provider's current catalog,
   never replacing it and never becoming a dependency.

Items 1–3 stand alone and deliver value without item 4.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Pick a current model in Settings (Priority: P1)

An administrator opens AI Content Studio settings, chooses a provider, and expects the model dropdown
to offer that provider's current generation of models. Today the dropdown offers a mix of current and
superseded identifiers, so the administrator either picks a model that is no longer the best option
or discovers their preferred model simply isn't listed. After this change the dropdown reflects what
each provider currently offers, and a fresh install defaults to a current, general-purpose model.

**Why this priority**: This is the entire user-visible defect. Everything else in this feature exists
to keep this from recurring. It is shippable on its own.

**Independent Test**: Open Settings in a running admin panel, cycle through all three providers, and
confirm every listed model is current and selectable; confirm a chat message succeeds against one
newly added model per provider; confirm a brand-new install starts on the new default.

**Acceptance Scenarios**:

1. **Given** a fresh install with no saved settings, **When** an administrator opens Settings, **Then**
   the active provider is Anthropic and the active model is the new current-generation default.
2. **Given** an administrator has selected Anthropic, **When** they open the model dropdown, **Then**
   the listed models are exactly the curated Anthropic set, with no superseded identifiers.
3. **Given** an administrator selects a newly added model and saves, **When** they send a chat message,
   **Then** the message is answered by that model without a provider "unknown model" error.
4. **Given** an administrator switches provider, **When** the previously selected model is not offered
   by the new provider, **Then** the selection resets to that provider's first listed model.
5. **Given** an administrator selects a newly added vision-capable model, **When** they attach an image
   and approve it, **Then** the image is sent to the model rather than silently dropped.

---

### User Story 2 - An existing install keeps working after upgrade (Priority: P1)

An existing install has a model saved in the plugin store that is no longer in the curated list, but
is still a valid, active model at the provider. Upgrading the plugin must not change which model that
installation is running, must not fail to load Settings, and must not present an empty or misleading
selection.

**Why this priority**: Same priority as US1 because it is the upgrade half of the same change. A
catalog refresh that silently switches a paying customer's model, or that renders a broken Settings
page, is a worse regression than the stale list it fixes.

**Independent Test**: Seed the plugin store with a saved model that the new curated list omits, upgrade,
open Settings, and confirm the saved model is still in effect, still visible, and chat still works.

**Acceptance Scenarios**:

1. **Given** a saved active model that is no longer in the curated list but is still valid at the
   provider, **When** the plugin is upgraded, **Then** the saved model is preserved unchanged and chat
   continues to work with it.
2. **Given** that same install, **When** an administrator opens Settings, **Then** the currently active
   model is visibly represented in the selection rather than appearing blank or defaulting to another
   model without the administrator acting.
3. **Given** that same install, **When** the administrator changes the selection and saves, **Then** the
   old identifier is replaced and does not reappear.

---

### User Story 3 - Model identifiers can't be written from memory (Priority: P2)

Anyone working in this repository — human or agent — is reminded, before their first action in a
session, that model identifiers must be verified against the provider's live catalog rather than
recalled, that the curated list is the single source of truth, and that documentation and the built
distribution must move with it. The reminder is derived from the curated list itself, so there is no
second copy of the list to drift out of sync.

**Why this priority**: Prevention, not repair. It has no user-visible effect on the admin panel, but it
is the only item that stops this feature from being needed again in six months.

**Independent Test**: Start a fresh session in the repository and confirm the standing rule and the
current catalog are present before the first prompt is acted on; edit the curated list and confirm the
reminder reflects the edit without any other file being changed.

**Acceptance Scenarios**:

1. **Given** a new working session in the repository, **When** the session starts, **Then** the standing
   rule about verifying model identifiers and the current contents of the curated list are available as
   context before any work begins.
2. **Given** a session that is resumed, cleared, or compacted, **When** it resumes, **Then** the same
   context is present again.
3. **Given** a model is added to or removed from the curated list, **When** the next session starts,
   **Then** the reminder reflects the change with no separate list to update.
4. **Given** the curated list cannot be read or parsed, **When** a session starts, **Then** the session
   still starts normally and the standing rule is still conveyed.

---

### User Story 4 - Governance allows augmenting the curated floor (Priority: P2)

Project governance currently forbids obtaining model lists from a provider's own catalog outright. That
prohibition was written to prevent two specific harms — needing a redeploy to switch models, and taking
a hard runtime dependency on a provider endpoint. It over-reaches: it also forbids a purely additive,
fully degradable refresh that causes neither harm. Governance is amended to state the intent directly —
the curated list is the floor and the fallback; a live refresh may augment it, must not be required for
the plugin to function, and must fall back to the curated list on any failure.

**Why this priority**: It unblocks US5 and closes the gap between the written rule and its actual intent.
It is independently deliverable and independently reviewable.

**Independent Test**: Read the amended governance document; confirm the prohibition is restated as a
floor-and-fallback rule, that the change is recorded with a version increment consistent with the
document's own versioning policy, and that the required change-summary record is present.

**Acceptance Scenarios**:

1. **Given** the amended governance document, **When** the provider-neutrality principle is read, **Then**
   it states the curated list is the floor and fallback and that a live refresh is optional, non-required,
   and degrades to the curated list on failure.
2. **Given** the amended document, **When** the per-commit quality gate is read, **Then** it includes a
   check that any change touching model identifiers had those identifiers verified against the live
   catalog in that same session.
3. **Given** the amendment removes an existing prohibition, **When** the document version is checked,
   **Then** it has been incremented per the document's own rule for removing a rule, and the change-summary
   record at the top of the file describes the change.

---

### User Story 5 - The dropdown reflects the provider's live catalog (Priority: P3)

An administrator who has already saved a working API key can refresh the model list for that provider
from the provider's own catalog, so a model released after the plugin shipped becomes selectable without
waiting for a plugin update. The curated list remains the guaranteed floor: the refresh only adds to it,
results are reused for a period rather than re-fetched on every page load, and any failure — network,
rejected key, malformed response — leaves the administrator with the curated list and a clear message
rather than an empty dropdown.

**Why this priority**: Highest surface area and lowest certainty of the five. It introduces new
privileged behavior, a caching policy, and a filtering rule, and it is the only item that depends on
US4 landing first. Deferring it costs nothing that US1 does not already deliver.

**Independent Test**: With a valid saved key, trigger a refresh for one provider and confirm models
absent from the curated list appear; disconnect the network and confirm the dropdown still shows the
full curated list with a non-blocking message.

**Acceptance Scenarios**:

1. **Given** a provider with a valid saved key, **When** an administrator refreshes the model list for
   that provider, **Then** the dropdown shows the curated models plus any additional current text-generation
   models the provider reports, with no duplicates.
2. **Given** a refresh returns a catalog that omits a curated model, **When** the dropdown is rendered,
   **Then** the curated model is still offered.
3. **Given** a provider's catalog includes non-conversational entries such as embedding, speech, or
   image-only models, **When** the list is presented, **Then** those entries are excluded.
4. **Given** the refresh fails for any reason, **When** the dropdown is rendered, **Then** it shows the
   complete curated list and a non-blocking message explaining the refresh did not succeed.
5. **Given** a refresh has recently succeeded, **When** Settings is reopened within the reuse window,
   **Then** the stored result is reused rather than contacting the provider again.
6. **Given** an administrator without super-admin rights, **When** they attempt to trigger a refresh,
   **Then** the request is refused, consistent with every other settings operation.
7. **Given** a refresh is triggered, **When** the response or any error is returned, **Then** it contains
   nothing key-like — no plaintext, no partial key, no header echo.

---

### Edge Cases

- **Saved model missing from the curated list**: The saved identifier is still valid at the provider. It
  must remain in effect and must remain visible in the selection rather than showing an empty control or
  silently snapping to another model. (Covered by US2.)
- **Saved model no longer valid at the provider**: The plugin cannot know this without contacting the
  provider. The failure surfaces on the next chat attempt as a provider error, redacted per existing
  rules; Settings does not attempt to pre-validate.
- **Provider switch strands the model**: Switching provider must always leave a valid selection for the
  newly chosen provider.
- **Vision capability for newly added identifiers**: The capability check is prefix-based. Newly added
  identifiers must be evaluated against it — including any that a live refresh could introduce, where the
  check stops being a check over a known list and becomes a check over arbitrary provider input.
- **Non-conversational entries in a provider catalog**: Provider catalogs mix embedding, speech, moderation,
  and image-only models into the same response; presenting those as chat models would produce guaranteed
  runtime failures.
- **Live catalog missing a model the plugin knows about**: Third-party or aggregated catalogs lag provider
  releases. A refresh source that omits a model the curated list contains must never cause that model to
  disappear.
- **Refresh with no key set, a rejected key, or a provider outage**: All three collapse to the same outcome —
  curated list, clear message, no broken dropdown.
- **Session-start reminder when the curated list is unreadable**: The session must start regardless.
- **Documentation and distribution drift**: A catalog change that ships without the corresponding docs
  update and rebuilt distribution is a shipped regression under existing project rules.

## Requirements *(mandatory)*

### Functional Requirements

**Curated catalog (US1)**

- **FR-001**: The curated Anthropic model list MUST be exactly: `claude-opus-5`, `claude-sonnet-5`,
  `claude-fable-5`, `claude-opus-4-8`, `claude-haiku-4-5`.
- **FR-002**: The curated OpenAI model list MUST be exactly: `gpt-5.6-sol`, `gpt-5.6-terra`,
  `gpt-5.6-luna`, `gpt-5.4`.
  **Amended 2026-08-09**: `gpt-5.3-codex` is dropped by maintainer decision. It is current at the
  provider but documented Responses-API-only, and the plugin resolves models through the provider
  registry's default surface — see [research.md](./research.md) R-003. No reachability check is
  therefore required before shipping.
- **FR-003**: The curated Google model list MUST be exactly: `gemini-3.6-flash`, `gemini-3.5-flash`,
  `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, `gemini-2.5-pro`, `gemini-2.5-flash`,
  `gemini-2.5-flash-lite`.
  **Q2 RESOLVED 2026-08-09 — retain the Flash Lite tier.** The maintainer elected to keep both
  `gemini-3.1-flash-lite` and `gemini-2.5-flash-lite`, which Phase 0 research (research.md R-004)
  confirmed are still current at the provider — not deprecated, not superseded, so removing them would
  have been a pure curation loss for cost-sensitive users. The `[NEEDS CLARIFICATION]` marker is
  discharged.
  **`gemini-3.1-pro-preview` is omitted** under the default-to-omit rule for an unresolved identifier
  gate (T003): it is present as a preview endpoint but absent from the current "All Gemini 3 models"
  table, and the one live send that would confirm it has not been run. Restoring it is a one-line
  addition once that send succeeds.
- **FR-004**: Every identifier in FR-001 through FR-003 MUST be verified against the corresponding
  provider's live catalog during implementation, before it ships. Identifiers in this specification are
  the intended set, not a verified set.
- **FR-005**: Each listed model MUST carry a human-readable label suitable for a dropdown caption.
- **FR-006**: The default active model for a fresh install MUST be `claude-sonnet-5`, and the default
  provider MUST remain Anthropic.
- **FR-007**: The image-input capability determination MUST return the correct answer for every identifier
  in FR-001 through FR-003, so that attachments are neither dropped for a capable model nor sent to an
  incapable one.

**Upgrade safety (US2)**

- **FR-008**: An upgrade MUST NOT change the active model of an existing install. A saved identifier is
  preserved verbatim even when it is no longer in the curated list.
- **FR-009**: When the saved active model is not present in the curated list for the saved provider, the
  Settings model selection MUST still represent the active model to the administrator rather than
  rendering blank or appearing to have selected something else.
- **FR-010**: Changing the provider MUST leave a valid model selected for the newly chosen provider.

**Freshness guardrail (US3)**

- **FR-011**: The repository MUST carry a standing, always-loaded instruction stating that model
  identifiers are never written from memory, that they are verified against the provider's live catalog
  before shipping, that the curated list is the single source of truth, and that documentation and the
  built distribution move with it.
- **FR-012**: At the start of every working session — including resumed, cleared, and compacted sessions —
  the standing instruction and the current contents of the curated list MUST be presented as context before
  the first task is acted on.
- **FR-013**: The session-start context MUST be derived from the curated list at read time. No second copy
  of the model identifiers may exist for this purpose.
- **FR-014**: If the curated list cannot be read or parsed, session start MUST still succeed and MUST still
  convey the standing instruction.

**Governance (US4)**

- **FR-015**: The provider-neutrality principle MUST be amended so that the curated list is defined as the
  floor and the fallback; a live refresh MAY augment it, MUST NOT be required for the plugin to function,
  and MUST degrade to the curated list on any failure.
- **FR-016**: The per-commit quality gate MUST gain an item requiring that any change touching model
  identifiers had those identifiers verified against the live catalog in the same session.
- **FR-017**: The governance document version MUST be incremented according to its own versioning rule for
  removing or incompatibly redefining a rule, and the amendment MUST include the change-summary record the
  document requires.

**Live refresh (US5)**

[NEEDS CLARIFICATION: is live model discovery (US4 + US5) part of this feature, or is this feature scoped
to the catalog refresh and guardrail (US1–US3) with governance and live refresh deferred? The source plan
explicitly held this decision open.
**Provisionally resolved for planning (research.md R-006): plan.md covers US1–US3 only.** US1–US3 is a
strict subset of every other answer, so if the decision comes back as "all five items", US4/US5 layer on
top with no rework. Under this scope Principle III is satisfied as written and needs no amendment.]

- **FR-018**: An administrator with super-admin rights MUST be able to refresh the selectable model list for
  a provider whose key is already saved, using the provider's own catalog as the source.
- **FR-019**: The refresh MUST be additive. The presented list is the curated list unioned with the provider's
  reported models, de-duplicated by identifier; a curated model MUST never be removed by a refresh.
- **FR-020**: The refresh MUST exclude entries that are not usable as conversational text-generation models
  (for example embedding, speech, transcription, moderation, and image-only entries).
- **FR-021**: A successful refresh result MUST be reused for a bounded period rather than re-requested on
  every Settings page load.
- **FR-022**: Any refresh failure MUST leave the administrator with the complete curated list and a clear,
  non-blocking message. The refresh MUST NOT block Settings from loading, and MUST NOT be required for chat.
- **FR-023**: Refresh MUST be restricted to the same authority level as every other settings operation, and
  its responses and errors MUST be free of key material, consistent with existing secret-handling rules.
- **FR-024**: The credential used for a refresh MUST remain server-side and MUST NOT be exposed to the
  browser at any point.
- **FR-025**: Where the source is a third-party aggregated catalog rather than the provider's own, it MUST
  NOT be treated as authoritative for which models exist.

**Documentation and distribution (all stories)**

- **FR-026**: The documentation section describing the curated list MUST be updated to show the new contents
  and to replace the "by design, not fetched" claim with the amended floor-and-fallback rule.
- **FR-027**: Any change to the curated list, the default model, or the capability check MUST ship together
  with a rebuilt distribution in the same change, per existing project rules.

### Key Entities

- **Curated model list**: The per-provider set of selectable models that ships with the plugin. Each entry has
  an identifier passed verbatim to the provider and a display label. It is the guaranteed floor: always
  present, always sufficient on its own.
- **Active selection**: The provider plus model identifier persisted per installation. Survives upgrades
  unchanged and may legitimately name a model absent from the curated list.
- **Provider catalog**: The set of models a provider currently reports for a given credential. Optional,
  augmentative, and never required.
- **Standing repository rule**: The always-loaded instruction governing how model identifiers may be
  introduced into this codebase.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An administrator can select and successfully chat with a current-generation model from each of
  the three providers, with zero "unknown model" errors across all curated identifiers.
- **SC-002**: 100% of curated identifiers are confirmed present in the corresponding provider's live catalog
  at the moment of shipping.
- **SC-003**: Zero superseded identifiers remain selectable in the dropdown after the change.
- **SC-004**: Upgrading an existing install changes the active model in 0% of cases, and Settings renders the
  active model correctly in 100% of upgraded installs, including those whose saved model is not curated.
- **SC-005**: The image-input decision is correct for 100% of curated identifiers — no image dropped for a
  capable model, none sent to an incapable one.
- **SC-006**: The standing rule and the current catalog are present at the start of 100% of sessions, across
  fresh, resumed, cleared, and compacted starts.
- **SC-007**: The catalog exists in exactly one place; changing it and starting a new session requires editing
  one file.
- **SC-008**: Governance no longer contains a rule that forbids what the shipped behavior does.
- **SC-009**: With the network unavailable or a key rejected, the model dropdown is non-empty in 100% of cases
  and shows the full curated list.
- **SC-010**: No refresh response or error message contains key material, verified by inspection of the
  success path and every failure path.
- **SC-011**: Reopening Settings within the reuse window contacts the provider zero additional times.
- **SC-012**: Documentation describing the model list matches the shipped list exactly, with no remaining
  claim that model lists are never obtained from a provider catalog.

## Assumptions

- **No migration of saved model identifiers.** Existing installs keep whatever they saved. The plan's own
  recommendation is followed: silently remapping an administrator's deliberate choice is worse than leaving a
  valid-but-uncurated identifier in place. The one identifier this concretely affects — `claude-sonnet-4-6` —
  is dropped from the dropdown but remains active at the provider, so nothing breaks.
- **The Google list in FR-003 is a full replacement, not a delta.** The source plan named only
  `gemini-3-flash-preview` as a removal, but its target list also omitted `gemini-3.1-flash-lite` and
  `gemini-2.5-flash-lite`, which are currently offered. ~~The explicit target list is treated as
  authoritative, so those two are dropped as well.~~ **Resolved 2026-08-09 — both are retained** (Q2).
  `gemini-3-flash-preview` remains the only Google removal.
- **`claude-haiku-4-5` is retained deliberately.** It is current, not superseded, despite the version-number
  pattern of the other retained entries.
- **The identifiers listed here require verification before shipping.** They were supplied in the source plan,
  and this specification is not itself a verified source — which is precisely the failure mode FR-011 exists to
  prevent. FR-004 makes the verification a requirement rather than an assumption.
- **The capability check needs no change for the curated set** — existing prefix rules already cover the new
  identifiers. It becomes load-bearing in a different way under US5, where its input is no longer a
  hand-reviewed list, so US5 must re-examine it rather than inherit it.
- **Provider catalogs are the source for US5, not an aggregated third-party catalog.** Aggregated catalogs lag
  provider releases; one was checked during planning and did not list a current model. They remain usable for
  labels and metadata, not for which models exist.
- **Reuse window for refreshed results**: a bounded period on the order of hours, long enough that Settings
  page loads do not generate provider traffic and short enough that a newly released model appears the same
  day. Exact duration is an implementation choice.
- **No automated test suite exists**; verification is manual in a running admin panel, per existing project
  rules.
- **Work commits directly to the default branch** with no co-authorship trailers, per existing project rules.

## Dependencies

- US5 depends on US4 landing first — the current governance text forbids it outright.
- US1, US2, US3, and US4 have no dependency on one another and can ship in any order.
- US5 depends on an already-saved, valid provider credential; it adds no new credential-entry surface.

## Out of Scope

- Replacing the prefix-based image-input capability check with provider-reported capability metadata. Noted as
  a possible future simplification once catalog responses are consumed, not undertaken here.
- Any change to how credentials are entered, encrypted, or masked.
- Any change to chat, tool calling, or permissions beyond what the model list requires.
- Automatic background refresh of model lists without an administrator action.
- Presenting pricing, context-window size, or other provider metadata in the dropdown.
