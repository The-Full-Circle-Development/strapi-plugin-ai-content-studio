# Specification Quality Checklist: Unified Provider Layer, Single Content Mode & Project-Grounded Prompt

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-04
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
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
- [x] No implementation details leak into specification

## Notes

- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`.

### Validation record

**Iteration 1 — self-review.** Two decisions were scope-forking and hard to reverse, so they were
put to the maintainer rather than assumed:

1. *Disposition of the audit capability* once its mode is removed. Answer: **retire it fully as a
   breaking change** — mode, tools, report surface, services, and the grantable permission. Encoded
   in FR-016 and FR-054, with the upgrade path in Edge Cases and Out of Scope.
2. *How far "stop hard-coding providers" goes.* Answer: **provider breadth is the adapter layer's
   responsibility, not the maintainer's** — "however many providers LangChain supports is how many
   there should be". The first draft had specified a maintainer-curated declaration list; it was
   rewritten. Encoded in FR-002, FR-004 and FR-011.

Both answers are recorded verbatim (in English) under the spec's Input field, so the plan phase can
see the intent and not just the outcome.

**Language.** On the maintainer's instruction, the specification, the assistant's system
instructions, and every shipped user-facing string are English — including the Input field, which
renders the original Ukrainian request in English rather than quoting it. Verified: zero Cyrillic
characters in spec.md. Encoded as a requirement (FR-025) and a success criterion (SC-012), and
localization is listed Out of Scope.

**Naming.** "LangChain" appears in the feature directory name, the Overview, and the Constitution
Alignment rationale — where naming the chosen dependency is the point — but not inside any
functional requirement. Requirements say "the provider-adapter layer", so they stay verifiable
against behaviour rather than against a library choice.

**Numbering.** FR-001 through FR-054 are contiguous with no gaps or duplicates; SC-001 through
SC-012 likewise.

**Constitution tension, resolved not waived.** Principle IV (self-contained distribution: committed
`dist/`, no consumer build step) is the one real bound on "every provider the adapter layer
supports", because LangChain's breadth comes from separate per-provider packages. The spec states
this openly in Assumptions and FR-011 — an unshipped provider must be *absent* from the selection,
never offered and broken — and hands the question of how wide the shipped set can be to the plan
phase as its first research task. It is recorded as a constraint on delivery, not as a narrowing of
the maintainer's stated intent.

**Iteration 2 — adversarial review.** The spec was reviewed by six independent lenses (constitution
compliance, fidelity to the request, testability, internal consistency, factual accuracy about the
current codebase, and implementation risk). The highest-severity findings from each lens were then
put to a skeptic instructed to refute them and to default to refuting when uncertain — 18 findings
verified, and **all 18 were formally refuted**.

That bias is deliberate (it filters nitpicks) but it also suppresses findings of the form "the spec
is defensible but imprecise". Three such were kept on review of the verifiers' own reasoning, each
re-checked directly against the source rather than taken on an agent's word:

1. **US6's rationale was factually wrong about the current system.** `publish` is already a
   proposable plan operation (`server/src/types.ts:15`, `server/src/services/tools.ts:343`) applied
   by the existing route (`server/src/services/change-sets.ts:664`). The original text claimed the
   editor must leave for the Content Manager to publish at all. Rewritten to state what is actually
   missing: an editor-initiated, risk-confirmed way to take a reviewed plan live. A false premise
   about today's behaviour is exactly what misleads the plan phase.
2. **FR-045's confirmation text understated the consequence.** Publication is document-scoped, so
   publishing makes the affected document's *entire current draft* visible — including another
   editor's unreviewed edits, which never appear in the plan's before/after rows. FR-045 now
   requires the confirmation to say so, with a matching edge case.
3. **SC-010 was unqualified** ("zero publishes without an explicit confirmation"), which conflicts
   with FR-051 preserving the pre-existing approve actions unchanged — those can apply a `publish`
   item with no publish-specific confirmation. Rescoped to the new combined action, with the
   unchanged behaviour of the existing actions stated as its own clause.

No other finding survived. The rejected ones were, in the main, either already answered by text the
finder had not read, or demands for implementation detail that belongs in the plan phase.
