# Specification Quality Checklist: Model Catalog Refresh & Freshness Guardrails

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-09
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [ ] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [ ] No implementation details leak into specification

## Notes

### Iteration 1 — 2026-08-09

**2 open [NEEDS CLARIFICATION] markers** (both surfaced as questions to the user, Q1 and Q2):

1. **FR-003** — the source plan's Google removals contradict its target list. It names only
   `gemini-3-flash-preview` as a removal, but the target list also omits `gemini-3.1-flash-lite` and
   `gemini-2.5-flash-lite`, both currently offered. Cannot be resolved by inference; either reading is
   plausible.
2. **US5 scope** — the source plan explicitly deferred the live-refresh decision ("the one piece I'd hold
   for your call"). This is a scope boundary, not a detail: it determines whether US4 (governance
   amendment) is needed at all, and it is the difference between a data change and a new privileged
   capability with a caching and filtering policy.

**"No implementation details leak" — partially satisfied, deliberately.** Two categories of concrete
detail remain because they *are* the requirement rather than a chosen means of meeting it:

- Model identifiers in FR-001–FR-003. These are the deliverable data, equivalent to a list of supported
  currencies. Removing them would leave the spec untestable.
- The default model in FR-006 (`claude-sonnet-5`).

No file paths, routes, function names, session-hook mechanics, or frameworks appear in the requirements.

**Verification caveat recorded in the spec itself** (FR-004): the identifiers here were supplied in the
source plan and are *not* verified against provider catalogs. This spec is not an authoritative source for
them — which is exactly the failure mode FR-011 exists to prevent. Verification is a shipping requirement,
not a planning assumption.

**Next action**: answer Q1 and Q2, then re-run validation. Both remaining unchecked items resolve on the
first — the second is already documented as intentional.

### Iteration 2 — 2026-08-09 (post-`/speckit-plan`)

Phase 0 research discharged FR-004 by verifying every identifier against its provider's live catalog.
Three findings change the spec's factual footing:

1. **FR-002 needs a caveat.** `gpt-5.3-codex` exists and is current, but is documented as
   **Responses-API-only** (Chat Completions "Not supported"). The plugin resolves models through the AI
   SDK provider registry's default surface, so this ID may be unreachable — a dropdown entry that fails
   every send, which would break SC-001. Gated behind plan task T-004; ships only if it passes.
   **Resolved 2026-08-09**: dropped by maintainer decision. FR-002 is now four identifiers, the
   reachability gate is removed, and the caveat no longer applies to anything shipped.
2. **Q2 is narrower than the spec framed it.** Both `gemini-3.1-flash-lite` and `gemini-2.5-flash-lite`
   are still current. Removal is curation, not correction.
3. **FR-008's assumption is now verified fact.** `claude-sonnet-4-6` is confirmed still Active, so the
   no-migration decision provably breaks nothing.

Also surfaced, not previously in the spec: `claude-fable-5` requires 30-day data retention and returns
`400` on **every** request from a zero-data-retention org. Handled as a README note (no code change
possible); recorded in research.md R-002 and quickstart Scenario 7.

**Q1 provisionally resolved** for planning as US1–US3 only. Marker retained — the maintainer's answer is
still outstanding; the plan simply chose the option that carries no rework risk either way.

Both `[NEEDS CLARIFICATION]` markers remain open, so "No [NEEDS CLARIFICATION] markers remain" stays
unchecked. Every other item passes. The spec is sound enough to plan and implement against — Q2 affects
two list entries, Q1 affects only whether more phases follow.

### Iteration 3 — 2026-08-09 (post-`/speckit-implement`)

**Q2 is resolved and its marker is discharged.** The maintainer elected to **retain** both
`gemini-3.1-flash-lite` and `gemini-2.5-flash-lite`. FR-003 is amended to seven identifiers and no
longer carries a `[NEEDS CLARIFICATION]` block; `gemini-3-flash-preview` is the only Google removal.

**One marker remains: Q1 (US5 scope).** It is a scope boundary, not a detail, and it does not block
anything built here — US1–US3 is a strict subset of every possible answer. "No [NEEDS CLARIFICATION]
markers remain" therefore stays unchecked, now on Q1 alone rather than both.

**"No implementation details leak" stays unchecked, still deliberately** — for the reason given in
Iteration 1. The model identifiers in FR-001–FR-003 *are* the deliverable data, and FR-006's default
model is a requirement rather than a chosen means. Neither is cruft; both would make the spec
untestable if removed. This item is expected to remain unchecked for the life of the feature.

**New, from implementation:** `gemini-3.1-pro-preview` is not shipped. Its confirming live send
(T003) could not be run without a provider key, and the spec's own default-to-omit rule applies. This
is not a spec-quality defect — it is the spec's guardrail working as designed — but it does mean the
shipped Google list is one entry shorter than FR-003 as originally drafted. See the implementation
status section of [tasks.md](../tasks.md) for the one-line restore.
