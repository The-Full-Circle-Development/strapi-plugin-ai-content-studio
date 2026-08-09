# Contract: Session-Start Model Context

**Producer**: `.claude/hooks/session-model-context.mjs` (new)
**Registered by**: `.claude/settings.json` (new)
**Consumer**: the Claude Code harness, which injects the payload as a system reminder before the first
prompt of a session.

Satisfies FR-011 through FR-014.

---

## Trigger

`SessionStart`, with matchers covering all four session-start kinds required by FR-012:

```text
startup | resume | clear | compact
```

Missing any one leaves a class of session without the reminder — a resumed session is exactly where a
model ID is most likely to be written from stale context.

---

## Output shape

The script writes a single JSON object to stdout:

```jsonc
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "<the standing rule, then the current catalog>"
  }
}
```

**Budget**: `additionalContext` must stay ≤10,000 characters. The catalog is ~16 entries; the standing
rule is a short paragraph. Expected payload is well under 2,000 characters, leaving ample headroom —
but a future catalog growth spurt should not be allowed to push it over, so the script truncates the
catalog section rather than the rule if it ever approaches the limit.

---

## `additionalContext` content

Two parts, in this order. The rule comes first because it is the part that must survive truncation.

### 1. The standing rule (literal, always emitted)

Conveys, in substance:

- Model identifiers are **never written from memory**. Verify against the provider's live catalog
  before shipping.
- `admin/src/data/models.ts` is the **single source of truth** for the curated list.
- A change to that file moves the **README and `dist/`** with it, in the same commit.

### 2. The current catalog (parsed at read time)

Rendered from `admin/src/data/models.ts` — the identifiers as they exist on disk right now, grouped by
provider. **No second copy of the list may exist anywhere** (FR-013): not in the hook script, not in
`CLAUDE.md`, not in `settings.json`.

---

## Failure behaviour (FR-014 — the important part)

The hook must **never block or fail a session**. Three failure modes, one response:

| Failure | Required behaviour |
|---|---|
| `models.ts` missing | Exit 0. Emit part 1 alone, with a one-line note that the catalog could not be read. |
| `models.ts` unparseable (refactored, malformed) | Exit 0. Emit part 1 alone, same note. |
| Any unexpected throw in the script | Exit 0. Emit part 1 alone, or nothing rather than a non-zero exit. |

A hook that throws on a malformed file would block every session in the repository — strictly worse
than the drift it exists to prevent. The standing rule is the load-bearing half; the catalog is the
convenience half.

**Acceptance**: temporarily rename `admin/src/data/models.ts`, start a session, confirm it starts
normally and the rule is still present. Restore the file.

---

## Parsing approach

Regex over the `MODELS` object literal's text. Deliberately **not** a TypeScript parser:

- The hook runs on every session start and must be fast — no dependency resolution, no compile step.
- The plugin's `devDependencies` are the build toolchain; a hook must not depend on them being
  installed.
- Node built-ins only, so the script works in a fresh clone before `pnpm install`.

The cost is coupling to the file's formatting, which is why that formatting is written down as a soft
contract in [model-catalog.md](./model-catalog.md) → *Parseability*.

---

## Relationship to `CLAUDE.md`

Two layers carrying the same rule, deliberately:

| Layer | Role | Failure mode it covers |
|---|---|---|
| `CLAUDE.md` | Always-loaded project instruction; the durable, reviewable statement of the rule | Hook not installed, hook broken, tooling that reads `CLAUDE.md` but not hooks |
| `SessionStart` hook | Injects the rule **plus the live catalog** as a fresh system reminder | `CLAUDE.md` scrolled far from the point of use in a long session; catalog drifted since the file was last read |

`CLAUDE.md` states the rule and **points at** `admin/src/data/models.ts` — it must not enumerate model
identifiers, which would create exactly the second copy FR-013 forbids.
