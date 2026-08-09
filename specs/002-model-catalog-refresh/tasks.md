# Tasks: Model Catalog Refresh & Freshness Guardrails

**Input**: Design documents from `/specs/002-model-catalog-refresh/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: No automated test tasks. The project has no test suite (Constitution Principle V); verification is manual in a running admin panel via [quickstart.md](./quickstart.md). Verification tasks are included as first-class tasks, not optional extras.

**Organization**: Tasks are grouped by user story. Scope is **US1–US3 only** per [research.md](./research.md) R-006 — US4 (governance amendment, FR-015–FR-017) and US5 (live refresh, FR-018–FR-025) are deferred and produce no tasks here.

**Branch**: `main` — project rule, no feature branches, no co-authorship trailers.

**Revision 2026-08-09**: `gpt-5.3-codex` was dropped by maintainer decision, so the OpenAI reachability gate is withdrawn and FR-002 is four identifiers. Task IDs were renumbered; 27 tasks total.

---

## Implementation status — 2026-08-09

**20 of 27 tasks complete.** All code, tooling, and documentation tasks are done; `typecheck` is
clean, `dist/` is rebuilt and staged with the source. The seven open tasks all require something
this session could not provide: a running Strapi admin panel with live provider keys, or a fresh
Claude Code session.

**Decisions taken during implementation**

- **Q2 resolved — retain the Flash Lite tier.** `gemini-3.1-flash-lite` and `gemini-2.5-flash-lite`
  are both kept (T004). FR-003 is now seven identifiers; `gemini-3-flash-preview` is the only
  Google removal. Recorded in `spec.md`, `data-model.md`, and `research.md`.
- **`gemini-3.1-pro-preview` does not ship** (T003 unresolved). The confirming live send could not
  be run, so the default-to-omit rule in the Notes below was applied. This is the one place the
  shipped list is narrower than the status quo — the identifier ships today and may well be valid.
  **To restore after one successful live send**, add to the `google` array in
  `admin/src/data/models.ts`:
  `{ id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (preview)' },`
  then reconcile FR-003, `data-model.md`, and the README snippet, and rebuild `dist/`.
- **Anthropic identifiers were verified in-session** against the bundled `claude-api` skill's model
  catalog: `claude-opus-5`, `claude-sonnet-5`, `claude-fable-5`, `claude-opus-4-8`, and
  `claude-haiku-4-5` are all Active, and `claude-sonnet-4-6` is confirmed **still Active** — which
  is what makes FR-008's no-migration decision provably safe. That source also independently
  confirms R-002 (Fable 5 requires 30-day retention; ZDR orgs get `400` on every request).
  The OpenAI and Google identifiers carry their Phase 0 verification only.

**What was verified statically, in lieu of the panel**

- Catalog invariants (contracts/model-catalog.md): 16 entries, every provider array non-empty, ids
  unique within each provider (T011).
- `modelSupportsVision()` returns `true` for all 16 shipped identifiers, checked against the actual
  prefix rules rather than assumed — so no change to `registry.ts` (T010, confirming R-005).
- The session-start hook (T017–T019) was exercised directly: happy path, run from an unrelated cwd,
  `models.ts` renamed aside, `MODELS` refactored into a call, empty file, and a synthetic
  900-entry catalog. **Every path exits 0 and emits valid JSON with the standing rule intact**;
  only the catalog section is ever truncated, and the payload stays inside the 10,000-char budget.
  A throwaway `MODELS` entry appeared in the reminder with no other file edited (SC-007).
- The built bundles were checked: all new ids present in `dist/admin`, all removed ids absent, and
  `activeModel: "claude-sonnet-5"` in both `dist/server/index.js` and `index.mjs`.

**Open — needs a running admin panel (or a new session)**

| Task | Blocked on | What to do |
|---|---|---|
| T002 | — | Stand up the host Strapi app: plugin linked, `AI_STUDIO_ENC_KEY` set, super-admin login, all three provider keys |
| T003 | Google key | Select `gemini-3.1-pro-preview`, send one message. If it answers, restore the entry (above). If it errors, the current omission was right — record it under R-004 |
| T012 | All three keys | quickstart Scenarios 1, 2, 5 — dropdown contents per provider, one live send per provider, store-cleared install starts on Claude Sonnet 5, image reaches a vision-capable model |
| T015 | Anthropic key | quickstart Scenarios 3, 4 — seed `activeModel: "claude-sonnet-4-6"` in `strapi_core_store_settings`, confirm it renders and still chats, **re-read the store to confirm nothing was rewritten on load**, then move to a curated model and confirm the synthetic entry does not return |
| T021 | New sessions | quickstart Scenario 6 steps 1–2 only — confirm the reminder appears on fresh **and** resumed **and** cleared **and** compacted starts. Steps 3–4 are already verified above |
| T026 | The above | Walk the pre-commit gate at the end of quickstart.md once T012/T015/T021 pass |
| T027 | The above | Commit to `main`. Everything is already staged; nothing was committed by this session |

**Most likely to surface a defect: T015.** The synthetic-option change is the one piece of new
runtime logic, and "nothing wrote on load" is the assertion no static check can make.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

Strapi plugin layout: `admin/` (React) + `server/` (Node) + committed `dist/`, plus repo tooling under `.claude/`. All paths below are relative to the repository root `/Users/andrewk/Development/strapi/ai-studio`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish a clean baseline and a working manual-verification environment before any source edit.

- [X] T001 Install dependencies and capture a clean pre-change baseline: run `corepack pnpm@10 install` then `corepack pnpm@10 run typecheck` at the repository root, confirming zero errors against `tsconfig.json` before any file is edited
- [ ] T002 [P] Prepare the manual-verification environment per the Prerequisites section of `specs/002-model-catalog-refresh/quickstart.md`: a host Strapi v5 app with this plugin linked, `AI_STUDIO_ENC_KEY` set, super-admin login, and at least one working provider API key (all three needed for Scenarios 1 and 5)

---

## Phase 2: Foundational (Catalog Gates — Blocking Prerequisites for US1 only)

**Purpose**: Resolve the two open items still carried out of Phase 0 research. Each decides the contents of one provider's list; neither can be answered by reading code alone.

**⚠️ CRITICAL**: These gate the *final contents* of `admin/src/data/models.ts` (US1). They do **not** block US2 or US3 — those stories may proceed in parallel with this phase.

- [ ] T003 [P] Confirm `gemini-3.1-pro-preview` is a currently valid API identifier with one live send from a running admin panel (it ships today, so this confirms the status quo), and record the result under R-004 in `specs/002-model-catalog-refresh/research.md`; drop the identifier if it errors
- [X] T004 [P] Resolve spec question Q2 with the maintainer — whether to also retain `gemini-3.1-flash-lite` and `gemini-2.5-flash-lite`, both still current at the provider ([research.md](./research.md) R-004) — and record the answer in FR-003 of `specs/002-model-catalog-refresh/spec.md` and in the `google` table of `specs/002-model-catalog-refresh/data-model.md`. Note that FR-003 already ships `gemini-3.5-flash-lite`, so a Flash Lite tier survives either way. **Default if unanswered**: FR-003 as written, both dropped

**Checkpoint**: The exact identifier set for `models.ts` is settled and written down. US1 can be implemented without guessing.

---

## Phase 3: User Story 1 - Pick a current model in Settings (Priority: P1) 🎯 MVP

**Goal**: The model dropdown offers each provider's current generation, and a fresh install defaults to a current, general-purpose model (`claude-sonnet-5`).

**Independent Test**: Open Settings in a running admin panel, cycle through all three providers, confirm every listed model is current and selectable, send a chat message against one newly added model per provider, and confirm a brand-new install starts on `claude-sonnet-5` / Anthropic.

**Note on `[P]`**: T005–T008 all edit `admin/src/data/models.ts` and therefore carry no `[P]` marker despite being logically independent. T009 and T010 touch different files and do run in parallel with them.

### Implementation for User Story 1

- [X] T005 [US1] Rewrite the `anthropic` array in `admin/src/data/models.ts` to exactly the five FR-001 identifiers with the labels from `specs/002-model-catalog-refresh/data-model.md`: `claude-opus-5`, `claude-sonnet-5`, `claude-fable-5`, `claude-opus-4-8`, `claude-haiku-4-5` — removing `claude-sonnet-4-6` from the dropdown only (it stays valid at the provider and must keep working wherever saved)
- [X] T006 [US1] Rewrite the `openai` array in `admin/src/data/models.ts` to exactly the four FR-002 identifiers — `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.4` — removing `gpt-4.1`, `gpt-4o`, and `o4-mini`. **Do not add `gpt-5.3-codex`**: it was dropped by maintainer decision ([research.md](./research.md) R-003)
- [X] T007 [US1] Rewrite the `google` array in `admin/src/data/models.ts` per FR-003 as adjusted by T003 and T004 — base set `gemini-3.6-flash`, `gemini-3.1-pro-preview`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-2.5-pro`, `gemini-2.5-flash` — removing `gemini-3-flash-preview`, and keeping or dropping `gemini-3.1-flash-lite` / `gemini-2.5-flash-lite` per T004
- [X] T008 [US1] Update the doc comment above `MODELS` in `admin/src/data/models.ts` to record the parseability contract from `specs/002-model-catalog-refresh/contracts/model-catalog.md`: entries stay single-line `{ id: '…', label: '…' }` literals with single-quoted ids and bare provider keys, because `.claude/hooks/session-model-context.mjs` parses this file as text
- [X] T009 [P] [US1] Change the default `activeModel` from `'claude-sonnet-4-6'` to `'claude-sonnet-5'` at `server/src/services/config.ts:65` (FR-006), leaving `activeProvider: 'anthropic'` and the `normalize()` merge at `server/src/services/config.ts:90-96` untouched so a stored value still wins over the default
- [X] T010 [P] [US1] Verify `modelSupportsVision` at `server/src/services/registry.ts:39-53` returns the correct answer for every identifier actually shipped by T005–T007, checking each against the prefix rules rather than assuming — no code change is expected per `specs/002-model-catalog-refresh/research.md` R-005; fix the rule only if an identifier is misclassified (FR-007, SC-005)
- [X] T011 [US1] Verify the invariants in `specs/002-model-catalog-refresh/contracts/model-catalog.md` hold on the edited `admin/src/data/models.ts`: every provider array has at least one entry (the unguarded `MODELS[next][0].id` index at `admin/src/pages/Settings.tsx:172-173` throws otherwise), ids are unique within each provider, and ids are passed verbatim with no normalization
- [ ] T012 [US1] Run Scenarios 1, 2, and 5 from `specs/002-model-catalog-refresh/quickstart.md` in a running admin panel — every dropdown entry matches `data-model.md`, no superseded ids remain, one newly added model per provider answers a chat message, a store-cleared install starts on Claude Sonnet 5, and an image attachment reaches a vision-capable model (SC-001, SC-002, SC-003, SC-005)

**Checkpoint**: US1 is fully functional and shippable on its own. The user-visible defect is fixed.

---

## Phase 4: User Story 2 - An existing install keeps working after upgrade (Priority: P1)

**Goal**: An install whose saved model is no longer curated keeps that model in effect, renders it visibly in Settings, and continues to chat with it — with nothing written on load.

**Independent Test**: Seed the plugin store with `activeModel: "claude-sonnet-4-6"`, restart, open Settings, and confirm the saved model is still in effect, still visible in the select, and chat still works; re-read the store and confirm nothing was rewritten.

### Implementation for User Story 2

- [X] T013 [US2] In `admin/src/pages/Settings.tsx` around line 190, derive the rendered option list as `MODELS[activeProvider]` plus a synthetic `{ id: activeModel, label: activeModel }` entry appended **only** when `activeModel` is absent from that list — recomputed on every render, using the raw identifier as its label (the plugin has no display name for a model it does not curate), never added to `MODELS`, never persisted, and never written back to the store on load (FR-008, FR-009; state transition in `specs/002-model-catalog-refresh/data-model.md`)
- [X] T014 [US2] Confirm the provider-switch reset at `admin/src/pages/Settings.tsx:172-173` still fires only on provider change and still leaves a valid curated selection for the newly chosen provider, so the synthetic entry disappears on switch (FR-010)
- [ ] T015 [US2] Run Scenarios 3 and 4 from `specs/002-model-catalog-refresh/quickstart.md` with a seeded stale `claude-sonnet-4-6` in `strapi_core_store_settings` — the select shows the active model rather than blank, chat answers unchanged, the store still reads `claude-sonnet-4-6` after load, and once the admin saves a curated model the synthetic entry is gone and does not return (SC-004)

**Checkpoint**: US1 and US2 both work independently. The upgrade path is safe.

---

## Phase 5: User Story 3 - Model identifiers can't be written from memory (Priority: P2)

**Goal**: The standing rule and the live catalog are present as context at the start of every session — fresh, resumed, cleared, and compacted — derived from `admin/src/data/models.ts` at read time with no second copy of the list anywhere.

**Independent Test**: Start a fresh session in the repository and confirm the rule and current catalog are present before the first prompt is acted on; add a throwaway entry to `MODELS`, start a new session, and confirm the reminder reflects it with no other file edited; rename `models.ts` aside and confirm the session still starts with the rule intact.

### Implementation for User Story 3

- [X] T016 [P] [US3] Create `CLAUDE.md` at the repository root stating the standing rule (FR-011): model identifiers are never written from memory and are verified against the provider's live catalog before shipping, `admin/src/data/models.ts` is the single source of truth for the curated list, and a change to it moves the README and `dist/` in the same commit. It **must point at** `admin/src/data/models.ts` and **must not enumerate identifiers** — that would be the second copy FR-013 forbids
- [X] T017 [P] [US3] Create `.claude/hooks/session-model-context.mjs` using Node built-ins only (no dependency resolution, no compile step, works in a fresh clone before `pnpm install`): read `admin/src/data/models.ts`, regex-parse the `MODELS` object literal into per-provider identifier groups, and write a single JSON object to stdout shaped as `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"<standing rule, then current catalog>"}}` per `specs/002-model-catalog-refresh/contracts/session-context.md`
- [X] T018 [US3] Implement the failure behaviour in `.claude/hooks/session-model-context.mjs` (FR-014): on a missing file, an unparseable `MODELS` literal, or any unexpected throw, exit 0 and emit the standing rule alone with a one-line note that the catalog could not be read — a hook that throws would block every session in the repository, strictly worse than the drift it prevents
- [X] T019 [US3] Enforce the ≤10,000-character budget on `additionalContext` in `.claude/hooks/session-model-context.mjs`, truncating the catalog section and never the standing rule, since the rule is the half that must survive truncation
- [X] T020 [US3] Create `.claude/settings.json` registering `.claude/hooks/session-model-context.mjs` as a `SessionStart` hook with matchers covering all four session-start kinds — `startup`, `resume`, `clear`, `compact` (FR-012) — leaving the existing `.claude/skills/` directory untouched
- [ ] T021 [US3] Run Scenario 6 from `specs/002-model-catalog-refresh/quickstart.md` including **step 4, the failure path**: verify the rule and catalog appear on fresh/resume/clear/compact starts, that adding a throwaway `MODELS` entry appears in the reminder with no other file edited, and that renaming `admin/src/data/models.ts` aside still yields a normal session start with the rule present (SC-006, SC-007)

**Checkpoint**: All three in-scope user stories are independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Documentation and distribution obligations that apply across all three stories, plus the constitution's per-commit gate.

- [X] T022 Update the "Updating the curated model list" section of `README.md` (around line 256) so its `MODELS` snippet matches the shipped list exactly, and add the note from `specs/002-model-catalog-refresh/research.md` R-002 that `claude-fable-5` requires 30-day data retention and returns `400` on every request under org zero-data-retention — a correctly-configured customer would otherwise see only a redacted generic error (FR-026, SC-012)
- [X] T023 Confirm the "by design — not fetched from any `/models` endpoint" claim in `README.md` still reads accurately and coherently under this scope — it does, per `specs/002-model-catalog-refresh/research.md` R-006 — and add a short pointer to `CLAUDE.md` and the session-start guardrail in the maintainer-facing part of `README.md`. **The FR-026 rewrite of that claim into floor-and-fallback language is deferred with US4** and is not done here
- [X] T024 Run `corepack pnpm@10 run typecheck` at the repository root and confirm zero errors (Constitution Principle V)
- [X] T025 Run `corepack pnpm@10 run build` and stage the resulting `dist/` changes together with the `admin/` and `server/` source in one commit (FR-027, Constitution Principle IV — stale `dist/` is a shipped regression)
- [ ] T026 Walk the full pre-commit gate checklist at the end of `specs/002-model-catalog-refresh/quickstart.md`: typecheck clean, `dist/` staged with source, Scenarios 1–7 exercised in a running admin panel, README updated in the same change, and every shipped identifier verified against the live provider catalog **in this session**
- [ ] T027 Commit directly to `main` with no co-authorship trailers, and state in the commit message which identifiers were verified in-session, that `gpt-5.3-codex` was deliberately omitted, and the outcomes of T003 and T004

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup. Blocks **US1 only** — specifically the contents of the `google` array. US2 and US3 have no dependency on it.
- **User Story 1 (Phase 3)**: Depends on Phase 2 for T007 (needs T003 and T004). T005, T006, T009, and T010 depend on Setup only — the OpenAI list is now fully settled, so T006 has no gate.
- **User Story 2 (Phase 4)**: Depends on Setup only. Independently implementable and testable; its verification (T015) is most meaningful once T005 has removed `claude-sonnet-4-6` from the curated list, but the code change does not require it.
- **User Story 3 (Phase 5)**: Depends on Setup only. Fully independent of both P1 stories — it touches no plugin source.
- **Polish (Phase 6)**: Depends on all three stories being complete. T022/T023 need the final catalog; T025 needs every `admin/`/`server/` edit landed.

### User Story Dependencies

- **US1 (P1)**: Gated by Phase 2 for the Google list only. No dependency on US2 or US3.
- **US2 (P1)**: No dependency on US1 or US3. The `Settings.tsx` change is correct regardless of the catalog's contents.
- **US3 (P2)**: No dependency on US1 or US2. Repo tooling only, excluded from `dist/` by `files: ["dist"]` in `package.json`.
- **US4 / US5**: Out of scope. US5 depends on US4 landing first; both are fully specified in `spec.md` and can be planned later with no rework to anything built here.

### Within Each User Story

- Catalog edits (T005–T008) before invariant verification (T011) before manual verification (T012).
- The `Settings.tsx` option-list change (T013) before the provider-switch confirmation (T014) before Scenario 3/4 verification (T015).
- The hook script (T017) before its failure behaviour (T018) and budget cap (T019) — all the same file; registration (T020) before Scenario 6 verification (T021).

### Parallel Opportunities

- **Phase 1**: T002 runs alongside T001.
- **Phase 2**: T003 and T004 are fully independent — one live send and one maintainer question.
- **Phase 3**: T009 (`server/src/services/config.ts`) and T010 (`server/src/services/registry.ts`) run in parallel with the `models.ts` edits. T005–T008 are the same file and must be sequential.
- **Phase 5**: T016 (`CLAUDE.md`) and T017 (`.claude/hooks/session-model-context.mjs`) are different new files and run in parallel.
- **Across stories**: once Phase 1 is done, US2 (T013–T014) and US3 (T016–T020) can proceed in parallel with all of US1, including while Phase 2's gates are still open.

---

## Parallel Example: Phase 2 Gates

```bash
# Two independent gate resolutions, launched together:
Task: "Confirm gemini-3.1-pro-preview with one live send in a running admin panel"
Task: "Ask the maintainer whether to retain the two older Flash Lite entries (spec Q2)"
```

## Parallel Example: Cross-Story Work After Setup

```bash
# US1 catalog edit, US2 UI fix, and US3 tooling touch disjoint files:
Task: "Rewrite the anthropic array in admin/src/data/models.ts"
Task: "Add the synthetic active-model option in admin/src/pages/Settings.tsx"
Task: "Create CLAUDE.md with the standing rule"
Task: "Create .claude/hooks/session-model-context.mjs"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: the two remaining catalog gates — this is what makes the MVP shippable rather than guessed.
3. Complete Phase 3: User Story 1.
4. **STOP and VALIDATE**: run quickstart Scenarios 1, 2, and 5 in a running admin panel.
5. Typecheck, build, stage `dist/`, commit. The user-visible defect is fixed at this point.

### Incremental Delivery

1. Setup + Foundational → the identifier set is settled and written down.
2. Add US1 → validate → ship (MVP: the dropdown is current, the default moves).
3. Add US2 → validate with a seeded stale value → ship (upgrades are safe).
4. Add US3 → validate including the failure path → ship (the list cannot silently rot again).
5. Polish: README, typecheck, build, `dist/`, commit.

Every increment must carry its own README update and rebuilt `dist/` if it touched `admin/` or `server/` — Principle IV applies per commit, not per feature.

### Parallel Team Strategy

With multiple people, after Phase 1:

- Person A: Phase 2 gates → US1 (`admin/src/data/models.ts`, `server/src/services/config.ts`)
- Person B: US2 (`admin/src/pages/Settings.tsx`)
- Person C: US3 (`CLAUDE.md`, `.claude/`)

No file overlaps between the three tracks. They converge at Phase 6, which is single-threaded because it builds and commits.

---

## Notes

- **[P] tasks** = different files, no dependencies. T005–T008 deliberately lack `[P]` because they share `admin/src/data/models.ts`.
- **No automated tests** by design (Constitution Principle V). T012, T015, T021, and T026 are the acceptance gate.
- **`gpt-5.3-codex` is deliberately absent**, not overlooked. It is current at OpenAI but was dropped on 2026-08-09: it is an agentic-coding specialist in a content-authoring dropdown, and it is documented Responses-API-only against a registry that resolves the provider's default surface ([research.md](./research.md) R-003).
- **Default-to-omit on an unresolved gate**: if T003 cannot be completed, `gemini-3.1-pro-preview` does not ship. Shipping an unverified id is exactly the failure mode this feature exists to prevent.
- **`activeModel` is never an allow-list check** against `MODELS`. Treating it as one would break FR-008 and every install saved on a dropped identifier.
- **Requirements not covered here**: FR-015–FR-017 (US4 governance) and FR-018–FR-025 (US5 live refresh) are out of scope. FR-026 is satisfied in part (T022/T023); its floor-and-fallback rewrite is deferred with US4.
- Commit after each logical group; stop at any checkpoint to validate a story independently.
