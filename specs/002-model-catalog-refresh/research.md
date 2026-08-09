# Phase 0 Research: Model Catalog Refresh

**Date**: 2026-08-09
**Feature**: [spec.md](./spec.md)
**Purpose**: Discharge FR-004 (verify every curated identifier against the provider's live catalog) and
resolve the spec's two open clarifications.

---

## R-001: Anthropic identifiers — VERIFIED, all five current

**Decision**: Ship `claude-opus-5`, `claude-sonnet-5`, `claude-fable-5`, `claude-opus-4-8`,
`claude-haiku-4-5` as specified. Default becomes `claude-sonnet-5`.

**Source**: The `claude-api` skill's model catalog (`shared/models.md`), an authoritative bundled
reference rather than recall. Its trigger fired on this task precisely because the prompt named
Claude model IDs.

| ID | Status | Context | Notes |
|---|---|---|---|
| `claude-opus-5` | Active | 1M | $5/$25 per MTok |
| `claude-sonnet-5` | Active | 1M | $3/$15 ($2/$10 intro through 2026-08-31) |
| `claude-fable-5` | Active | 1M | $10/$50 — **see R-002** |
| `claude-opus-4-8` | Active | 1M | $5/$25 |
| `claude-haiku-4-5` | Active | 200K | $1/$5 — retained deliberately, not superseded |

**`claude-sonnet-4-6` is still Active.** This directly confirms the spec's no-migration assumption:
an existing install holding that value keeps working after the upgrade. The assumption is now a
verified fact, not a guess.

**Rationale**: All five exist; the two the plan drops implicitly (nothing) and the one it retains
against the version-number pattern (`claude-haiku-4-5`) are both correct.

**Alternatives considered**: Adding `claude-opus-4-7` / `claude-opus-4-6` (still Active) for a longer
tail — rejected: the curated list is a *recommended* set, not an exhaustive one, and both are
superseded by `claude-opus-4-8` at identical pricing.

---

## R-002: `claude-fable-5` carries a hard org-level precondition

**Decision**: Keep it in the list, and document the precondition in the README.

**Finding**: Claude Fable 5 **requires 30-day data retention and is not available under zero data
retention**. An organization configured for ZDR gets `400 invalid_request_error` on *every* Fable 5
request, regardless of payload.

**Why this matters here**: The plugin surfaces provider errors redacted and gated behind
`showProviderErrorDetails` (default `false`, per Principle I). A ZDR customer selecting Fable 5 sees
a generic failure with no route to the real cause. This is the one curated model that can be
correctly configured and still fail 100% of the time for reasons the plugin cannot detect.

**Rationale for keeping it**: It is a legitimately current, top-tier model, and the failure is a
provider-side org policy rather than a plugin defect. Removing it would deny it to the majority who
can use it.

**Mitigation**: A one-line note in the README's model-list section. No code change — the plugin
cannot query an org's retention setting.

---

## R-003: OpenAI identifiers — all five exist, one is dropped

**Decision**: Ship `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.4`. **`gpt-5.3-codex` is
dropped** — maintainer decision, 2026-08-09.

> **RESOLVED 2026-08-09.** The maintainer elected to drop `gpt-5.3-codex` rather than gate it on a
> reachability check. Both reasons below stand on their own: the Responses-API-only risk is now moot
> because the ID does not ship, and the curation argument (an agentic-coding specialist in a
> content-authoring dropdown) applies regardless of reachability. **T-004 is withdrawn** — there is
> no longer anything for it to gate. FR-002 is amended to four identifiers.

**Source**: `developers.openai.com/api/docs/models` and per-model pages (fetched 2026-08-09;
`platform.openai.com/docs/models` now 301s to that host).

| ID | Exists | Verdict |
|---|---|---|
| `gpt-5.6-sol` | Yes | Current frontier. Ship. |
| `gpt-5.6-terra` | Yes | Current, balanced. Ship. |
| `gpt-5.6-luna` | Yes | Current, cost-optimized. Ship. |
| `gpt-5.4` | Yes | Current general-purpose chat; text+image; 1.05M context; **Chat Completions and Responses both supported**. Ship. |
| `gpt-5.3-codex` | Yes | Current, but **Responses API only — Chat Completions explicitly "Not supported"**. Coding-specialized. **Dropped, see below.** |

### The `gpt-5.3-codex` problem (retained as the rationale for dropping it)

`gpt-5.3-codex` is documented as working **exclusively with the Responses API**; the Chat Completions
endpoint is marked "Not supported".

[registry.ts:95](../../server/src/services/registry.ts#L95) builds the OpenAI model through
`createOpenAI({ apiKey })` and resolves it via `registry.languageModel('openai:<id>')` — the
provider's *default* language-model surface. Whether `@ai-sdk/openai` v3's default is Responses or
Chat Completions determines whether this model works at all:

- If the default is Chat Completions → **every message on `gpt-5.3-codex` fails**. A model in the
  dropdown that errors on every send is exactly the class of defect FR-001–FR-003 exist to prevent,
  and it would violate SC-001 (zero "unknown model" errors across all curated identifiers).
- If the default is Responses → it works, and the only remaining question is curation fit.

**This was resolvable in-repo** — a one-line check against the installed `@ai-sdk/openai` plus one
live send. It was not run: the maintainer dropped the ID outright, which resolves the risk without
spending the check.

**Separate curation point — this is the one that decided it**: `gpt-5.3-codex` is an agentic-coding
specialist tuned for Codex-style environments with hosted shell and function calling. In a *content
studio* dropdown next to three general-purpose models, it is a poor choice for a marketing editor.
That argument holds whether or not the ID is reachable, which is why the reachability check was never
needed.

**A correction to an intermediate finding**: a search snippet indicated "GPT-5.4 and GPT-5.4 mini
retire from Codex on August 31, 2026". That retirement is **Codex-surface only**. The `gpt-5.4` API
model page states no deprecation or retirement date. `gpt-5.4` is safe to ship.

### Omission worth noting

`gpt-5.5` and `gpt-5.5-pro` are current and general-purpose, and sit between `gpt-5.4` and the
`gpt-5.6-*` family. Neither appears in the proposed list. Not a defect — flagged so the omission is
deliberate rather than accidental.

### Dropped IDs confirmed correct

`gpt-4.1`, `gpt-4o`, and `o4-mini` are absent from the current lineup. Dropping them is right.

---

## R-004: Google identifiers — five confirmed, one ambiguous, two live models silently dropped

**Decision**: Ship `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-2.5-pro`,
`gemini-2.5-flash`. **Confirm `gemini-3.1-pro-preview`** (T-005). Resolve the two silent drops with
the maintainer (spec Q2).

**Source**: `ai.google.dev/gemini-api/docs/models` (fetched 2026-08-09).

| ID | In docs | Note |
|---|---|---|
| `gemini-3.6-flash` | Yes | New addition. Ship. |
| `gemini-3.5-flash` | Yes | Already listed. Keep. |
| `gemini-3.5-flash-lite` | Yes | New addition. Ship. |
| `gemini-2.5-pro` | Yes | Already listed. Keep. |
| `gemini-2.5-flash` | Yes | Already listed. Keep. |
| `gemini-3.1-pro-preview` | **Ambiguous** | Appears as an endpoint under Preview, but not in the "All Gemini 3 models" table. Already in the shipped list today, so presumed working. |
| `gemini-3.1-flash-lite` | **Yes — still current** | Currently shipped; the target list omits it. |
| `gemini-2.5-flash-lite` | **Yes — still current** | Currently shipped; the target list omits it. |
| `gemini-3-flash-preview` | No | Correctly dropped. |

**This resolves the substance of spec Q2.** Both `gemini-3.1-flash-lite` and `gemini-2.5-flash-lite`
are **still current models** — they are not deprecated, superseded, or broken. Removing them is a
pure curation choice, not a correctness fix. The question to the maintainer is therefore narrower
than the spec framed it: *do you want a Flash Lite tier in the dropdown at all?* If yes, keeping the
2.5 one costs nothing.

> **Q2 RESOLVED 2026-08-09 — retain the Flash Lite tier.** The maintainer elected to keep both
> `gemini-3.1-flash-lite` and `gemini-2.5-flash-lite`. FR-003 is amended to seven identifiers, and
> `gemini-3-flash-preview` becomes the only Google removal. Nothing else in the plan changes: both
> identifiers already ship today, so this is a retention, not an addition, and no new verification is
> owed.

> **T003 UNRESOLVED 2026-08-09 — `gemini-3.1-pro-preview` does not ship.** The confirming live send
> requires a running admin panel with a Google API key and was not run in this session. Under the
> default-to-omit rule recorded in tasks.md, an identifier whose gate cannot be closed is not shipped:
> the entry is removed from `models.ts` rather than carried forward unverified. This is the one place
> where the implemented list is narrower than the "keep what works" instinct would suggest — the
> identifier ships today and may well be fine, but "probably fine" is precisely the standard FR-011
> exists to replace. **To restore after one successful live send**, add back to the `google` array:
> `{ id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (preview)' },` and update FR-003,
> data-model.md, and the README snippet in the same commit.

---

## R-005: The vision capability check needs no change — verified per identifier

**Decision**: No change to [registry.ts:39-53](../../server/src/services/registry.ts#L39-L53).

Evaluated every new identifier against the actual prefix rules rather than assuming:

| Identifier | Rule matched | Returns | Correct? |
|---|---|---|---|
| all five `claude-*` | `m.startsWith('claude-')` | true | ✅ all Anthropic chat models are multimodal |
| all six `gemini-*` | `m.startsWith('gemini-')` | true | ✅ all Gemini chat models are multimodal |
| `gpt-5.6-sol` / `-terra` / `-luna` | `m.startsWith('gpt-5')` | true | ✅ |
| `gpt-5.4` | `m.startsWith('gpt-5')` | true | ✅ documented text+image |
| ~~`gpt-5.3-codex`~~ | `m.startsWith('gpt-5')` | true | ✅ documented text+image — **row retained as a record only; the ID was dropped and does not ship** |

Zero false positives, so no image is sent to a model that would reject it — FR-007 and SC-005 hold
with the existing code. The `/embedding|tts|whisper|moderation|audio|realtime/` guard is not tripped
by any new ID.

**The plan's characterization is confirmed**: no change needed now. It becomes load-bearing only
under US5, where the input stops being a hand-reviewed list.

---

## R-006: Scope — items 1–3 only

**Decision**: Implement US1, US2, US3. Defer US4 (constitution amendment) and US5 (live refresh).

**Rationale**: The source plan explicitly held item 4 for the maintainer's call and stated items 1–3
ship independently. The clarification (spec Q1) is unanswered at plan time, so this plan takes the
recommended option — and critically, **US1–US3 is a strict subset of every other answer**. If the
answer comes back as "all five items", nothing planned here is wasted; US4 and US5 are additional
phases layered on top. Planning the subset is the only choice with no rework risk.

**Constitution consequence**: Under this scope, **Principle III is fully satisfied and needs no
amendment.** The prohibition reads: *"Model lists are curated and hardcoded in
`admin/src/data/models.ts`. They MUST NOT be fetched from a provider `/models` endpoint."* Editing
the curated map is exactly the sanctioned path. The session-start hook reads a local file, not a
provider endpoint. FR-004's verification is a development-time activity by the maintainer, not
plugin runtime behavior. No violation, no amendment, no Complexity Tracking entry.

---

## R-007: Session-start hook mechanics

**Decision**: `.claude/settings.json` `SessionStart` hook running a script that parses
`admin/src/data/models.ts` at read time.

**Findings**:
- `.claude/` exists but contains only `skills/`. No `settings.json`, no `CLAUDE.md` at repo root.
  Both are new files.
- Matchers `startup|resume|clear|compact` cover FR-012's four session-start kinds.
- The hook returns `hookSpecificOutput.additionalContext`, injected as a system reminder before the
  first prompt.
- Budget is ~10k characters. The full catalog is 16 entries plus labels — comfortably under.

**FR-013 (single source of truth)**: the script parses `models.ts` rather than embedding a copy. A
regex over the `MODELS` object literal is sufficient and avoids adding a TypeScript parser
dependency to a hook that must start fast.

**FR-014 (degrade safely)**: the script must exit 0 and still emit the standing rule when the parse
fails. A hook that throws on a malformed file would block every session in the repo — a worse
failure than the drift it prevents.

---

## Open items carried into tasks

| ID | Question | Resolves via |
|---|---|---|
| ~~T-004~~ | ~~Does `@ai-sdk/openai` v3's default surface support `gpt-5.3-codex`?~~ | **Withdrawn 2026-08-09** — ID dropped, nothing left to gate |
| T-005 / T003 | Is `gemini-3.1-pro-preview` a currently valid API identifier? | **Still open** — needs one live send. Default-to-omit applied; the identifier does not ship. |
| ~~Q2~~ | ~~Drop or keep `gemini-3.1-flash-lite` / `gemini-2.5-flash-lite` (both still current)?~~ | **Resolved 2026-08-09** — both retained |
