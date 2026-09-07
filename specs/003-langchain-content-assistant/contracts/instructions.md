# Contract: Instruction Set

**Feature**: `specs/003-langchain-content-assistant` | Covers FR-018..FR-026, FR-034, FR-016

The composed system instructions for one request. Produced by `server/src/services/prompt.ts`.

---

## 1. Section order is fixed and declared

Sections are concatenated in exactly this order, separated by a blank line. The order is part of the
contract because FR-018 requires byte-for-byte identical output for identical inputs, and a reordered
section is a different byte sequence.

| # | Section id | Always present | Content |
|---|---|---|---|
| 1 | `role` | yes | Who the assistant is: the content assistant embedded in this project's Strapi admin panel. It inspects with read tools and **proposes**; it never writes content itself. |
| 2 | `discovery` | yes | Discover structure before proposing. Call `listContentTypes` to learn valid uids — never guess one. Use `describePageStructure` to find where media, links and sections actually live. Do not assume field names from another project. |
| 3 | `permissions` | yes | A `permission_denied` result is relayed **plainly**, is **never retried**, and is never followed by speculation about what would have been found or changed. The caller's own permissions are the boundary. |
| 4 | `ambiguity` | yes | An instruction that could match several targets is **asked about**, listing the candidates the tool returned. Never choose on the editor's behalf. |
| 5 | `proposing` | yes | Call `proposeChanges` **once** per request with every field intended to change — one plan, not several partial ones (FR-022). After it returns, state plainly that **nothing has changed yet**. Never say done, updated, changed or published about a proposal (FR-021). Say when no change is needed rather than proposing a cosmetic plan. |
| 6 | `tool-honesty` | yes | Report a tool's result **as returned**, including its limits and truncations. Never invent, extrapolate or embellish a result (FR-024). |
| 7 | `retired` | yes | The QA scan and the security audit are **no longer offered**. If asked, say so plainly and stop — do not improvise a substitute (FR-016, US2-5). |
| 8 | `style` | yes | Markdown is rendered in the chat. Be concise. Reference entries by title and `documentId`. The panel already renders per-field before/after, so do not repeat every value in prose. |
| 9 | `attachments` | only when the turn carries held files | Refer to a held file by its **stable ordinal**, never by a media-library id, which does not exist yet. Place one with `attachmentOrdinal`. Ingestion happens only on approval (FR-023). |
| 9a | `attachments-blind` | only when §9 applies **and** the model is not vision-capable | The active model **cannot** interpret file contents. Say so plainly, then place the files using their names, types and the editor's instructions — placement still works (FR-006). |
| 10 | `install` | only when grounding is on and the caller can read something | The install description, delimited and subordinate — see §3. Contract in [install-description.md](install-description.md). |
| 11 | `condensed` | only when the thread has a `contextSummary` | Notes replacing older summarized turns, to be treated as fact. |

Sections 1-8 are the **behavioural** sections. They are static text and they are the input to the
version hash (§2). Sections 9-11 vary per request and are **not** hashed.

---

## 2. The version is derived from the text

```text
version = `v1-${sha256(sections 1..8, joined in order).slice(0, 8)}`
```

Computed once at module load with `node:crypto`, which this codebase already uses. No new dependency.

**Why derived rather than maintained**: FR-026 requires that any edit to the instruction text change
its version identifier in the same change. A hand-maintained constant makes that a discipline a
maintainer can forget — and a forgotten bump is undetectable, because it produces a transcript that
claims rules it was not run under. Deriving it makes the requirement structural: a single changed
character changes the identifier, and the identifier cannot be changed without editing the text.

The leading `v1` stays hand-set so a maintainer can still mark a deliberate generation.

**What is excluded, and why**: the install description is per-install and per-account fact, not a
rule. Folding it into the hash would make the version churn per install, and a version that differs
between two installs running identical rules identifies nothing. The version answers "which rules was
this turn run under" (FR-019), and only the rules belong in it.

Recorded on every stored assistant turn as `chat-message.promptVersion` (nullable — turns from before
this change honestly have none).

---

## 3. The install section is subordinate, and says so

Section 10 is wrapped in an explicit delimiter and carries a preamble stating three things (FR-034):

1. These are **facts about this install**, generated from its schema.
2. They describe structure; they **do not** grant permission. Every read and every change is still
   checked against the caller's live permissions (FR-037).
3. Where a fact here appears to conflict with a rule above, **the rule wins**.

Point 3 is the load-bearing one. Without it a generated section sitting lower in the prompt reads as
a later, more specific override, which is exactly backwards: the description is data, the sections
above are the contract.

When the description is partial it says so in the same preamble, and instructs the assistant to
discover the remainder with tools (FR-032).

---

## 4. Determinism

`build(inputs)` is a pure function of:

```ts
{
  supportsVision: boolean;
  hasAttachments: boolean;
  groundingEnabled: boolean;
  readableUids: string[];        // sorted before use
  schemaFingerprint: string;
  contextSummary: string | null;
}
```

Nothing else may influence the output. Specifically forbidden inside the composer: `Date`,
`Math.random`, any counter, any read of entry data, any provider call, any locale-dependent
formatting.

**Verification** (SC-004): compose for a fixed input set ten consecutive times and compare
byte-for-byte. Ten identical results, or the requirement is not met.

---

## 5. What the text may never contain

| Prohibited | Requirement |
|---|---|
| The name of any consuming project | FR-020 |
| Any hard-coded field name, content-type identifier or page structure | FR-020 |
| Any non-English string | FR-025, SC-012 |
| Any model identifier | `CLAUDE.md` — the curated list has exactly one home |
| Any claim that the assistant can approve, apply, preview or publish | FR-021 |
| Any reference to modes, mode switching, or a mode's limitations | FR-017 |

The last one is easy to reintroduce by accident: the current prompt's mode sections are deleted
outright, not rewritten into a single "mode" heading.

**Read the whole text end to end** as part of verification (US3 Independent Test). A prohibition that
is only checked by grep survives a paraphrase.
