# Quickstart: Validating the Model Catalog Refresh

**Date**: 2026-08-09 | **Plan**: [plan.md](./plan.md)

There is no automated test suite (Principle V), so this *is* the acceptance gate. Every scenario below
maps to a success criterion in [spec.md](./spec.md). Run them in a real Strapi admin panel.

## Prerequisites

- Node `>=20 <=24`, `corepack pnpm@10`
- A host Strapi v5 app with the plugin linked, `AI_STUDIO_ENC_KEY` set, super-admin login
- At least one working provider API key. Scenarios 1 and 5 need all three to be complete.

```bash
corepack pnpm@10 install
corepack pnpm@10 run typecheck   # must be clean before anything else
corepack pnpm@10 run build
```

---

## Gate 0 — The one remaining identifier check

**Run this before finalizing the catalog.** It gates whether one specific ID ships.

> **`gpt-5.3-codex` no longer needs a gate.** It was dropped by maintainer decision on 2026-08-09
> ([research.md](./research.md) R-003), so the Responses-API reachability check that used to live here
> is withdrawn. Nothing in the shipped OpenAI set depends on a non-default provider surface.

### T-005 — Is `gemini-3.1-pro-preview` live? (confirming)

Present as a preview endpoint but absent from the current "All Gemini 3 models" table. It ships today,
so this confirms the status quo rather than a new addition.

Select it, send one message. If it errors, drop it and say so in the commit message.

---

## Scenario 1 — Current models are selectable and work (SC-001, SC-002, SC-003)

Maps to US1.

1. Open **Settings → AI Content Studio**.
2. For each of Anthropic, Google, OpenAI: open the model dropdown and read every entry.
   - ✅ Every listed ID matches [data-model.md](./data-model.md).
   - ✅ No `claude-sonnet-4-6`, `gpt-4.1`, `gpt-4o`, `o4-mini`, `gemini-3-flash-preview`.
3. Select one **newly added** model per provider, save, and send a chat message.
   - ✅ Answers. No "unknown model" / 404 / 400.

Minimum viable set if keys are scarce: `claude-sonnet-5`, `gpt-5.6-terra`, `gemini-3.6-flash`.

---

## Scenario 2 — Fresh install starts on the new default (SC-001)

```bash
# In the host app's DB — clears the plugin store entry, forcing defaults()
DELETE FROM strapi_core_store_settings WHERE key LIKE '%ai-content-studio%';
```

Restart Strapi, open Settings.

- ✅ Active provider `Anthropic`, active model **Claude Sonnet 5**.

---

## Scenario 3 — Upgrade preserves an uncurated saved model (SC-004) ⚠️ the important one

Maps to US2. This is the regression this feature is most likely to introduce.

1. Seed a stale-but-valid value:

```sql
-- inspect first
SELECT value FROM strapi_core_store_settings WHERE key LIKE '%ai-content-studio%';
```

Set `activeProvider: "anthropic"`, `activeModel: "claude-sonnet-4-6"` (still Active at Anthropic — see
[research.md](./research.md) R-001), keeping the encrypted key fields untouched.

2. Restart. Open Settings.
   - ✅ The model control **shows the active model**, not blank and not silently something else.
   - ✅ It is *not* offered as a normal curated choice once you move off it.
3. Send a chat message without changing anything.
   - ✅ Answers — the saved model still reaches the provider.
4. Re-read the store.
   - ✅ `activeModel` is still `claude-sonnet-4-6`. **Nothing wrote on load.**
5. Now pick `claude-sonnet-5`, save, reopen.
   - ✅ Selection persisted; the synthetic `claude-sonnet-4-6` entry is gone and does not return.

---

## Scenario 4 — Provider switch always leaves a valid selection (FR-010)

1. With an uncurated model active (Scenario 3, step 2), switch provider to Google.
   - ✅ Model resets to the first curated Google entry. No blank, no crash.
2. Switch back to Anthropic.
   - ✅ A valid Anthropic model is selected.

---

## Scenario 5 — Vision decision is correct per model (SC-005)

Maps to FR-007. Verified statically in research.md R-005; confirm behaviourally on at least one.

1. Select a newly added vision-capable model (`claude-opus-5`, `gemini-3.6-flash`, or `gpt-5.4`).
2. Attach an image, approve the ingest, ask what's in it.
   - ✅ The model describes the image — bytes were sent, not silently dropped.
   - ✅ No provider error about unsupported content type.

---

## Scenario 6 — Session-start reminder (SC-006, SC-007)

Maps to US3. No admin panel needed.

1. Start a fresh session in this repo.
   - ✅ The standing rule is present before the first task.
   - ✅ The current catalog is present and matches `admin/src/data/models.ts`.
2. Resume, clear, and compact a session.
   - ✅ Present in all three (FR-012).
3. Add a throwaway entry to `MODELS`, start a new session.
   - ✅ It appears in the reminder, with no other file edited (FR-013, SC-007). Revert.
4. **Failure path** — rename `admin/src/data/models.ts` aside, start a session.
   - ✅ Session starts normally. The standing rule is still conveyed (FR-014). Restore the file.

Step 4 is the one people skip. A hook that hard-fails here blocks every session in the repo — worse
than the drift it prevents.

---

## Scenario 7 — Docs and distribution move together (SC-012, Principle IV)

1. `README.md` → "Updating the curated model list".
   - ✅ Snippet matches the shipped list.
   - ✅ The "by design — not fetched from any `/models` endpoint" claim is still accurate under this
     scope (it is — see [research.md](./research.md) R-006) and reads coherently.
   - ✅ Notes that `claude-fable-5` requires 30-day data retention and fails under org ZDR
     (research.md R-002) — a correctly-configured customer would otherwise see only a redacted error.
2. `corepack pnpm@10 run build && git status`
   - ✅ `dist/` changes are staged with the source, in one commit.

---

## Pre-commit gate

Per the constitution's per-commit gate, all four must hold:

- [ ] `pnpm run typecheck` clean
- [ ] `pnpm run build` run, `dist/` staged with the source
- [ ] Scenarios 1–7 exercised in a running admin panel
- [ ] README updated in the same change
- [ ] *(this feature)* Every shipped identifier verified against the live provider catalog **in this
      session** — the rule FR-011 institutionalizes, applied to its own introduction

---

## Rollback

The catalog is data. Revert `admin/src/data/models.ts`, `server/src/services/config.ts`, and
`admin/src/pages/Settings.tsx`, rebuild, commit. Existing installs are unaffected either way — no
migration ran, and `activeModel` was never rewritten.
