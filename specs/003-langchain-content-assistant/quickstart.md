# Quickstart: Validating the LangChain Provider Layer, Single Mode & Grounded Prompt

**Feature**: `specs/003-langchain-content-assistant` | **Date**: 2026-09-07

Verification is split by what can actually fail.

**Automated** (FR-055, four jest suites over pure functions — T014a, T052a, T060a): the byte-identical
composition of the instructions, the deterministic derivation and tiered degradation of the install
description, the declared image-input rule, and configuration normalization. None of them calls a
model, so none of them can flake on model output.

**Manual, in a running Strapi admin panel** — this guide: everything that only fails in integration.
Streaming, tool activity, stop, permission denials, replay of pre-existing conversations, the UI, and
one live send per shipped provider. A provider that has not answered a real message has not been
verified; "should work" is not verification.

Each scenario below names the requirement it proves and the observation that counts as proof. Where a
suite already covers the mechanical half of a scenario, the row says so — run the human half anyway,
because a passing unit test says the function is right, not that the feature works.

---

## Prerequisites

- A Strapi v5 host app with this plugin linked, its admin panel reachable.
- `AI_STUDIO_ENC_KEY` set to a valid 32-byte key. A missing or wrong-length key must abort boot with
  a clear message that does not log the key.
- A live credential for **each provider whose path changed** — all four, since the whole layer moved:
  Anthropic, OpenAI, Google, and one OpenAI-compatible endpoint (a hosted aggregator or a local
  `ollama` / `vLLM` / LM Studio server).
- Two admin accounts: a **super-admin**, and a **restricted** account holding `chat.use` but *not*
  publish permission on at least one content type, and *no read* permission on at least one other.
- **At least one conversation created before this change**, ideally one recorded under the Layout
  Mapping or Code Audit mode, kept for the replay checks.

## Setup

```bash
corepack pnpm@10 install
corepack pnpm@10 run typecheck      # MUST be clean before any commit
corepack pnpm@10 run test           # MUST be clean before any commit — no suite calls a model
corepack pnpm@10 run build          # dist/ is committed alongside the source
```

Record the bundle size, before and after the change:

```bash
wc -c dist/server/index.js          # baseline measured 2026-09-07: 1600257
du -sh dist/                        # baseline measured 2026-09-07: 4.5M
```

The number is **recorded, not gated**: the growth is accepted as the price of the provider layer, on
the maintainer's decision — a git dependency is fetched once and then cached, so the cost lands at
install and not per use (plan → Risks). Record it anyway, so the cost is known rather than
discovered later.

Then run the host app and open **AI Content Studio** in the admin panel.

---

## A. Provider layer (US1, P1)

Repeat A1-A3 **for each of the four shipped providers**, switching the active provider between runs.

| # | Do | Expect | Proves |
|---|---|---|---|
| A1 | Save the credential (and, for `openai-compatible`, the base URL), select a model, send a message that needs a tool call and produces a change plan | Reply streams **progressively**; tool activity appears **as it happens**; the plan renders as an approvable card; stop works; approval produces a per-item report — all identical to before | FR-009, US1-1 |
| A2 | Switch the active provider in settings, send the next message | It reaches the new provider. **No restart, no redeploy**, under one minute | FR-007, SC-001, US1-3 |
| A3 | Press stop mid-turn | Server-side work ends; the partial reply reads as **interrupted**; a plan approved during that turn is still reported | FR-009, edge case |
| A4 | Configure `openai-compatible` against an endpoint the plugin never supported before, and send a live message | It answers, with **zero** plugin-side integration code written for it | FR-002, SC-002, US1-2 |
| A5 | For a provider with no curated list, type the provider's own model identifier; save; reload | Used **verbatim**; survives the round trip unchanged | FR-004, US1-4, edge case |
| A6 | Set `activeModel` to an identifier that is not in the curated list for a curated provider; send a message | Still used **verbatim** — a curated list is a convenience, never an allow-list | FR-005, US1-5 |
| A7 | Clear a provider's credential, or disable it, then send | A plain configuration message **naming the provider**, before generation starts. No credential material in the reply, the logs or the interface | FR-008, FR-010, US1-6 |
| A8 | Select `openai-compatible` and save with **no** base URL, then send | A configuration-shaped message naming the provider **and the field** — not a truncated stream | FR-010, edge case |
| A9 | Enter an invalid base URL (relative, or with a userinfo component) | `400` naming the field. The URL is never rendered beside or confused with the credential | FR-008, edge case |
| A10 | Attach an image and send it on a model **not** declared vision-capable | Image bytes are withheld; the assistant says plainly it cannot read file contents; placing the file **by name still works** | FR-006, US1-7 |
| A11 | Force a provider error (bad credential) with `showProviderErrorDetails` off | Generic message; **nothing credential-shaped** echoed anywhere | FR-008, US1-8, SC-009 |
| A12 | Read the request path and the built bundle for `LANGSMITH_*` / `LANGCHAIN_*` tracing | Absent. No prompt or run data leaves the host by default | Principle I, research D8 |
| A13 | Attach an image and send it on a model whose declared rule **does** return vision-capable (contracts/provider-layer.md §3) | The bytes reach the provider and the assistant answers about the image's **contents**. Image input still works exactly where it worked before this change | FR-006, FR-009, US1-1 |

**A10 and A13 are a pair, and A13 is the one that is easy to skip.** A descriptor left at bare
default-deny passes A10 and fails nothing else — the images are withheld correctly and quietly from
models that could have read them, and the capability is simply gone. Run both. The *rule* itself is
covered exhaustively by T014a's matrix; what these two scenarios prove is the other half — that the
bytes are actually dropped from, or actually reach, a live provider.

**A14 — the credential sweep (SC-009).** After A1-A13, across every shipped provider, every error
path, the grounding inspector and the server logs: **zero** occurrences of credential material.

---

## B. Single mode & audit retirement (US2, P1)

| # | Do | Expect | Proves |
|---|---|---|---|
| B1 | Open the chat panel; look at the conversation list, its header and the composer | **No mode control anywhere.** No text refers to modes, mode switching, or a mode's limitations | FR-012, FR-017, US2-1 |
| B2 | Start a new conversation and send the first message | Handled as content editing, with **no selection step** | FR-012, US2-2 |
| B3 | Open a conversation stored **before** this change, recorded under a mode that no longer exists | It opens, replays its **full** history, and accepts a follow-up | FR-013, SC-003, US2-3 |
| B4 | In that restored conversation, find a turn containing a `runQaScan` / `runSecurityAudit` result | Renders as a generic tool pill. Reads as something that happened, **without implying the capability is available** | FR-016, edge case |
| B5 | Ask where a page's media or sections live | Answered by discovery, with **no mode switch** | FR-014, US2-4 |
| B6 | Ask for a QA scan, then for a security audit | Each answered plainly that the capability is **no longer offered**. Never silently missing; no improvised substitute | FR-016, US2-5 |
| B7 | Search the source and the built bundle for the removed services, policy, component, tools, types, config key and permission action | All absent. **No unreachable remnant** | FR-016 |
| B8 | Upgrade an install where a role had been granted `audit.run` | The upgrade does not fail; the stored grant is inert; the removal is documented in `README.md` as a breaking change naming the version | FR-054, edge case |

---

## C. Instructions (US3, P2)

| # | Do | Expect | Proves |
|---|---|---|---|
| C1 | **Covered by T052a** — the ten comparisons run in the suite, not by hand. Here, only confirm the suite is green and that the composed text a real request carries matches what the suite composes | **Byte-for-byte identical** every time | FR-018, SC-004, US3-1 |
| C2 | Read the composed text **end to end** | English; names no specific customer project; assumes no specific field names; no model identifier; no reference to modes | FR-020, FR-025, US3-2 |
| C3 | As the restricted account, ask for something it lacks permission for | Says so plainly; does **not** retry; does **not** speculate about what it would have found or changed | FR-021, US3-3 |
| C4 | Give an instruction that could match several targets | Lists the candidates and **asks** rather than choosing | FR-021, US3-4 |
| C5 | Ask it to summarize a plan it just recorded | States that **nothing has changed yet**; never says done, updated, changed or published | FR-021, US3-5 |
| C6 | Ask for a change that is not needed | Says so instead of proposing a cosmetic plan | FR-021, US3-6 |
| C7 | Ask for two things in one message that both touch content | **One** plan containing every field, not several partial plans | FR-022 |
| C8 | Read a tool result, then the assistant's account of it | Reported **as returned**, including its limits and truncations. Nothing invented, extrapolated or embellished | FR-024 |
| C9 | Edit one character of the instruction text, rebuild, send a message, inspect the stored turn | `promptVersion` **changed**, without anyone editing a version constant | FR-019, FR-026, US3-7 |
| C10 | Inspect a turn stored before this change | `promptVersion` is `null` — honest, not backfilled | FR-019 |

---

## D. Install description (US4, P2)

| # | Do | Expect | Proves |
|---|---|---|---|
| D1 | Ask which field holds a page's main image | Field names that **exist in this install**; none invented from elsewhere | FR-027, US4-1, SC-005 |
| D2 | Send the same request twice on an unchanged schema and same account | The embedded description is **identical** | FR-030, US4-2 |
| D3 | Add a content type to the running project, send the next message | The description includes it, **with no restart** | FR-033, US4-3 |
| D4 | Sign in as the account with no read access to a content type; send a message | That content type is **absent** from the description | FR-031, US4-4 |
| D5 | **Covered by T060a** — the tier walk runs against a fixture, where a schema big enough to blow any budget is one object. Here, force it once on the real install (`grounding.maxChars` to its `2000` floor in `config/plugins.ts`, restart, compose) to confirm the real schema walk agrees with the fixture | The tier sequence is walked in order — `full` → `no-components` → `names-only` → content types dropped from the **end of the sorted order** with the dropped count stated. Every tier below `full` sets `partial` and carries the partial preamble instructing discovery with tools. `charCount` **never** exceeds `maxChars`. Two consecutive composes at the same setting are byte-identical | FR-032, US4-5, SC-011 |
| D6 | Inspect the description on any install | No entry values, no media URLs, no user data, nothing secret-like | FR-029, US4-6 |
| D7 | Turn grounding **off** by each switch in turn — first the settings `Toggle`, then the `grounding.enabled` plugin-config key — and send a message after each | Both fall back to tool-based discovery; **nothing else** about behaviour changes; stored history stays valid. With the config key off, the `Toggle` renders disabled and the inspector reports `disabledBy: "config"` — the runtime toggle cannot re-enable it | FR-036, US4-7, contracts/install-description.md §7, edge case |
| D8 | As an account with `settings.read`, open the grounding inspector | Shows the **exact** text requests are currently carrying — not a re-render, not a sample | FR-035, US4-8 |
| D9 | As an account that can **read** but not **update** a described content type, propose a change to it | The plan item still comes back **blocked with a reason** — the description authorized nothing | FR-031, FR-037, US4-9, edge case |
| D10 | Change the schema between two turns of one conversation | The newer description applies from the next request; the assistant does not treat the earlier one as still true | FR-033, edge case |
| D11 | **The ten-question structural probe** on a project never described to the assistant | Zero invented field names; **at least eight of ten** answered without the editor first supplying a content-type identifier | SC-005, SC-006 |
| D12 | Run a **thirty-turn** conversation on the largest available project | It completes | SC-011 |

**On D5.** The budget is forced rather than sought, because a 24,000-character budget is not reached
by an ordinary schema: a tier that is never entered is a tier that ships unexercised, and "verified
on the largest project I had" is not a repeatable observation. Restore `maxChars` to its default
before running D12.

---

## E. Copy (US5, P3)

| # | Do | Expect | Proves |
|---|---|---|---|
| E1 | Send a message returning formatted text with a list **and** a code block; copy the message; paste | The **Markdown source**, with a brief visible confirmation | FR-038, FR-040, US5-1 |
| E2 | Copy the code block | **Only** the block's contents, without surrounding prose | FR-039, US5-2 |
| E3 | Find a message that is only a plan card or an apply report | Either a readable plain-text rendering, or **no control at all** — never one that copies nothing | FR-043, US5-3 |
| E4 | Make the clipboard unavailable (plain-HTTP host, or deny the permission) | The fallback runs; if it also fails, an **explicit failure message** — never a silent no-op | FR-040, US5-4, research D13 |
| E5 | Reach the control by keyboard only, then with a screen reader | Focusable, English label, operable without a pointer, outcome announced | FR-041, US5-5 |
| E6 | Reload, reopen the thread, copy a restored reply | Behaves identically to a live one | FR-042, US5-6 |
| E7 | Try to copy a reply that is **still streaming** | Either unavailable until the turn finishes, or copies exactly what has arrived. Never a partial value presented as complete | edge case |

---

## F. Approve & Publish (US6, P3)

| # | Do | Expect | Proves |
|---|---|---|---|
| F1 | With a plan holding two field changes on a draft-and-publish type, use the risky action and confirm | Both fields written; the document **published**; the report states per item what was written **and** that it was published | FR-044, FR-050, US6-1 |
| F2 | As an account **without** publish permission on one target | That publish is reported **blocked with the permission reason**; the field write still applies where allowed; no target is left half-published without the editor being told | FR-046, US6-2, SC-010 |
| F3 | Use the risky action on a plan containing an item that removes content | The **separate** destructive confirmation is still required, **in addition** to the publish confirmation | FR-048, US6-3 |
| F4 | Use it on a content type that does **not** use draft and publish | Reported **live on save**; no publish attempted | FR-047, US6-4 |
| F5 | Change a target document from another session, then use the risky action | The conflicting item is neither applied nor published; the editor is told the document moved on | FR-049, US6-5 |
| F6 | Use Approve all / Approve selected / Reject | **Exactly as before**, in behaviour and appearance | FR-051, US6-6, SC-010 |
| F7 | Activate the risky action once and do **not** confirm; then navigate away or dismiss | **Nothing applied and nothing published** | FR-045, US6-7 |
| F8 | Reload the conversation after F1 | The same per-item report replays from the transcript | FR-050, US6-8 |
| F9 | Read the confirmation text before confirming | States that the result becomes publicly visible immediately **and** that the entire current draft goes live — not only the reviewed fields — so unreviewed draft edits go with it | FR-045, edge case |
| F10 | Publish a document whose required fields are empty, so the host refuses | The item is reported **failed with the host's reason**; the field write's outcome is reported **separately and accurately** | edge case |
| F11 | Use the risky action on an expired plan, then on one already applied | Refused with the **same** explanation as the existing approve actions | edge case |
| F12 | Have two editors act on the same plan simultaneously | One wins; the other is told the plan was already resolved | edge case |
| F13 | Count across the whole pass | The combined action **never** published without its confirmation — zero occurrences. 100% of publish attempts by an account lacking permission reported blocked with a reason | SC-010 |
| F14 | Take a proposed change from proposal to publicly visible without leaving the panel | At most **two** deliberate actions, one of which is the confirmation | SC-008 |

---

## G. Cross-cutting

| # | Do | Expect | Proves |
|---|---|---|---|
| G1 | Diff a turn stored **after** the change against one stored **before** | Same part types, same field names, same nesting. The storage shape did not move | FR-013, research D5 |
| G2 | Confirm the client was **not** modified for the provider swap | `useChat`, the transport and the wire protocol are unchanged (the `mode` body field aside) | FR-009 |
| G3 | Send a turn needing several discovery calls before proposing | Completes — `recursionLimit` did not silently tighten the ceiling | research D6 |
| G4 | Grep the built output for non-English strings | Zero | FR-025, SC-012 |
| G5 | `corepack pnpm@10 run typecheck` | Clean, zero errors | Constitution V |
| G6 | Confirm `dist/` is staged with every source change | No stale `dist/` | Principle IV |

---

## Definition of done

- Every scenario above observed in a running admin panel, not reasoned about.
- All twelve success criteria met: SC-001..SC-012.
- `corepack pnpm@10 run typecheck` and `corepack pnpm@10 run test` clean; `dist/` rebuilt and staged
  with each commit.
- `README.md` updated for providers, the removed modes and capabilities, the grounding setting and
  its default, and the new approval action — plus every breaking change with its version
  (FR-053, FR-054).
- The constitution amendment (research D16) committed **first**, in its own `docs:` commit with an
  updated Sync Impact Report.
- Bundle size recorded before and after, and the delta stated in the commit body. No threshold gates
  the change.
