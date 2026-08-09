# AI Content Studio — working rules

## Model identifiers are never written from memory

This is the standing rule of this repository, and it has no exceptions.

A model identifier is a string the provider either accepts or rejects. Recalling one is guessing:
model lineups change faster than any training cutoff, plausible-looking ids (`claude-sonnet-4-5-20250929`,
`gpt-5-turbo`, `gemini-3-pro`) are frequently wrong, and a wrong id is not a compile error — it is a
dropdown entry that fails on every send, in a customer's admin panel, with the provider's error
redacted by design.

So, before any identifier ships:

1. **Verify it against the provider's own current catalog in this session** — its live model docs or
   its `/models` response. Not from memory, not from a previous session's notes, not from this
   repository's own history. Past verification is evidence about the past.
2. **Confirm it is reachable through the surface the plugin actually uses.** Existing in a provider's
   catalog is necessary but not sufficient: an id documented as available only on a non-default API
   surface will fail here, because `server/src/services/registry.ts` resolves the provider's default
   language-model surface. This has already cost one candidate id.
3. **Check the image-input rule.** `modelSupportsVision()` in `server/src/services/registry.ts` is
   prefix-based. Check each new id against those prefixes rather than assuming — a false positive
   sends image bytes to a model that rejects them and breaks the whole request.

If an id cannot be verified, it does not ship. Omitting a model is a small, reversible loss;
shipping an unverified one is the exact defect this rule exists to prevent.

## `admin/src/data/models.ts` is the single source of truth

The curated per-provider list lives in [`admin/src/data/models.ts`](admin/src/data/models.ts). Do not
copy identifiers into prompts, tests, agent instructions, or this file — a second copy is a second
thing to keep current, and it will drift. Point at the file instead.

The **one** sanctioned exception is the snippet in `README.md`, which maintainers need in order to
see the shipped list without opening the source. That exception is exactly why the README is on the
same-commit list below: a sanctioned copy is still a copy, and it only stays true if it moves with
the original.

That file's formatting is load-bearing: `.claude/hooks/session-model-context.mjs` reads it as text so
that the session-start reminder derives from the real list rather than a copy. The parseability
contract is documented in the file's own doc comment — read it before restructuring the map.

The list is **curated and hardcoded by design.** It is not fetched from a provider `/models`
endpoint, and adding such a fetch would violate the project constitution (Principle III).

## A change to the model list moves three things in one commit

Editing `models.ts` is never a one-file change:

- **`README.md`** — the "Updating the curated model list" section carries a snippet of the list; it
  must match what actually ships.
- **`dist/`** — the built bundles are committed so consumers need no build step. Run
  `corepack pnpm@10 run build` and stage `dist/` alongside the source. Stale `dist/` is a shipped
  regression, not a follow-up.
- **`corepack pnpm@10 run typecheck`** must be clean before committing.

There is no test suite. Verification is manual, in a running Strapi admin panel: one live send per
provider whose list changed. A model that has not answered a real message has not been verified.

## Repository shape

Strapi v5 plugin: `admin/` (React) + `server/` (Node), built into a committed `dist/`. Commits go
directly to `main` — no feature branches, and no co-authorship trailers.
