# Implementation Plan: Model Catalog Refresh & Freshness Guardrails

**Branch**: `main` (project rule — no feature branches) | **Date**: 2026-08-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-model-catalog-refresh/spec.md`

## Summary

Bring the curated per-provider model list current, move the default model with it, and install a
standing guardrail so the list cannot silently rot again. Scope is **US1–US3 only**; US4 (constitution
amendment) and US5 (live refresh) are deferred pending the maintainer's answer to spec Q1 — see
[research.md](./research.md) R-006 for why that subset carries no rework risk.

Every identifier was verified against its provider's live catalog during Phase 0, discharging FR-004
before implementation rather than after. That verification changed the plan in two places: one OpenAI
identifier (`gpt-5.3-codex`) was flagged as Responses-API-only and has since been **dropped by
maintainer decision**, and the Google question turned out to be narrower than the spec framed it.

**Technical approach**: a data-only edit to `admin/src/data/models.ts` plus a one-line default change
in `server/src/services/config.ts`; a small UI change in `admin/src/pages/Settings.tsx` so an
uncurated-but-valid saved model still renders (FR-009); two new repo-tooling files (`CLAUDE.md`,
`.claude/settings.json` + hook script); README update; rebuild and commit `dist/`.

## Technical Context

**Language/Version**: TypeScript, Node `>=20.0.0 <=24.x.x`, CommonJS. React 18.

**Primary Dependencies**: Strapi v5, `ai` v6, `@ai-sdk/{anthropic,openai,google}` v3,
`@strapi/design-system` v2. No new dependencies — the hook script uses Node built-ins only.

**Storage**: Strapi plugin store (`plugin::ai-content-studio.settings`). No schema change; the shape
of `activeModel` is unchanged, only the default value.

**Testing**: No automated suite (Principle V). Manual verification in a running admin panel, plus
`pnpm run typecheck`.

**Target Platform**: Strapi v5 admin panel, consumed as a committed-`dist/` git dependency.

**Project Type**: Strapi plugin — `admin/` (React) + `server/` (Node) + committed `dist/`.

**Performance Goals**: The session-start hook must not perceptibly delay session start — a single
file read and regex parse, no network, no subprocess.

**Constraints**: Hook output ≤10k characters. `dist/` must be rebuilt and staged in the same commit
as any `admin/`/`server/` change (Principle IV). Provider errors stay redacted (Principle I).

**Scale/Scope**: 15 curated model entries across 3 providers (5 Anthropic, 4 OpenAI, 6 Google);
4 source files touched, 3 files created.

## Constitution Check

*GATE: passed before Phase 0. Re-checked after Phase 1 — still passing.*

| Principle | Applies? | Assessment |
|---|---|---|
| **I. Secrets encrypted, never echoed** | Not engaged | No change to crypto, settings routes, key handling, or error surfacing. Under the deferred US5 this would become the dominant gate; under this scope nothing touches a key path. |
| **II. Per-caller RBAC on every tool** | Not engaged | No tool added or changed. No route added. Settings remain super-admin-only via existing policy. |
| **III. Provider neutrality, runtime switchable** | **Engaged — PASS** | The principle *requires* model lists to be curated and hardcoded in `admin/src/data/models.ts` and forbids fetching them from a provider `/models` endpoint. This plan edits that map — the sanctioned path. Nothing in scope fetches a provider catalog at runtime. FR-004's verification is a maintainer activity at development time. The session-start hook reads a local file. **No amendment required; see research.md R-006.** All three providers remain interchangeable; no controller or UI branches on provider identity. |
| **IV. Self-contained distribution** | **Engaged — PASS by task** | T-010 rebuilds and stages `dist/`; T-009 updates the README in the same change. Both are gate items, not follow-ups. |
| **V. Verified in a real admin panel** | **Engaged — PASS by task** | T-011 exercises the happy path per provider in a running panel and the upgrade path with a seeded stale value. `pnpm run typecheck` is T-008. |

**Technology & Security Constraints**: no new dependency, no new UI framework, no new route, no change
to `server/src/` layering, and the config default has a safe value so an upgrade never breaks an
existing install. All satisfied.

**Complexity Tracking**: not required — no violations to justify.

## Project Structure

### Documentation (this feature)

```text
specs/002-model-catalog-refresh/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 — provider verification, scope decision
├── data-model.md        # Phase 1 — entities and validation rules
├── quickstart.md        # Phase 1 — manual validation guide
├── contracts/
│   ├── model-catalog.md   # The curated-list shape and its consumers
│   └── session-context.md # The session-start hook's output contract
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
CLAUDE.md                              # NEW — standing rule (FR-011)
.claude/
├── settings.json                      # NEW — SessionStart hook registration (FR-012)
├── hooks/
│   └── session-model-context.mjs      # NEW — parses models.ts, emits context (FR-013/FR-014)
└── skills/                            # existing, untouched

admin/src/
├── data/models.ts                     # EDIT — the curated map (FR-001..FR-003, FR-005)
└── pages/Settings.tsx                 # EDIT — render uncurated saved model (FR-009)

server/src/services/
├── config.ts                          # EDIT — default activeModel → claude-sonnet-5 (FR-006)
└── registry.ts                        # UNCHANGED — verified correct (research.md R-005)

README.md                              # EDIT — "Updating the curated model list" (FR-026)
dist/                                  # REBUILT + committed (FR-027, Principle IV)
```

**Structure Decision**: The existing Strapi-plugin layout is unchanged. This feature adds no
directories under `server/src/` and no routes; the only structural addition is repo tooling under
`.claude/`, which ships to consumers as ordinary repo content and is excluded from `dist/` by the
`files: ["dist"]` field in `package.json`.

## Phase 1 Design Notes

### The one non-obvious code change: FR-009

[Settings.tsx:190](../../admin/src/pages/Settings.tsx#L190) renders options from
`MODELS[activeProvider]`. The reset at
[Settings.tsx:172-173](../../admin/src/pages/Settings.tsx#L172-L173) fires **only on provider
change**. So an install saved on `claude-sonnet-4-6` — still an Active model, per research.md R-001 —
loads Settings with a `SingleSelect` whose `value` matches no `SingleSelectOption`.

The fix must satisfy FR-008 (don't change the saved model) and FR-009 (show it) simultaneously.
Approach: derive the rendered option list as the curated list for the active provider, plus a synthetic
entry for `activeModel` when it isn't already present. That entry disappears once the admin picks
something else and saves (FR-003 of US2's acceptance scenarios). No store migration, no write on load.

### Task ordering

```text
T-001  Refresh the Anthropic + Google entries in models.ts       (verified — safe to write)
T-002  Refresh the OpenAI entries, minus gpt-5.3-codex           (four verified IDs)
T-003  Bump config.ts default to claude-sonnet-5
T-004  WITHDRAWN — gpt-5.3-codex dropped by maintainer decision; nothing left to gate
T-005  Confirm gemini-3.1-pro-preview is a live identifier
T-006  Settings.tsx — render the active model when uncurated (FR-009)
T-007  CLAUDE.md + .claude/settings.json + hook script (FR-011..FR-014)
T-008  pnpm run typecheck
T-009  README — new snippet, rewrite the "not fetched" claim, note Fable 5 retention
T-010  pnpm run build; stage dist/ with the source
T-011  Manual verification in a running admin panel (Principle V)
```

T-001..T-003 are independent and can land together. T-005 is now the only identifier gate, and it
covers one entry; it blocks none of the other fourteen. The executable breakdown lives in
[tasks.md](./tasks.md), whose numbering is independent of the T-0NN sketch above.

### Risks carried from Phase 0

| Risk | Impact | Handling |
|---|---|---|
| ~~`gpt-5.3-codex` is Responses-API-only~~ | ~~Ships a model that errors on every message; breaks SC-001~~ | **Closed 2026-08-09** — dropped by maintainer decision, so the risk cannot materialize. |
| `gemini-3.1-pro-preview` not in the current model table | Same | T-005. It ships today, so status quo is a live send away from confirmation. |
| `claude-fable-5` 400s under org ZDR | A correctly-configured customer sees only a redacted generic error | README note (T-009). Not detectable in-plugin. |
| Two still-current Flash Lite models dropped | Silent capability loss for cost-sensitive users | Maintainer call (spec Q2) — research.md R-004 reframes it as "do you want a Flash Lite tier?" |

## Deferred (out of scope for this plan)

- **US4** — constitution amendment. Not needed under this scope; Principle III is satisfied as written.
- **US5** — live refresh route, TTL cache, catalog filter, super-admin policy. Depends on US4.

Both remain fully specified in [spec.md](./spec.md) and can be planned as a follow-up without
revisiting anything built here.
