# Contract: Permissions & enforcement matrix

**Feature**: [../spec.md](../spec.md) | **Constitution**: Principle II (non-negotiable) | **Date**: 2026-08-07

## Registered actions

Registered in `server/src/bootstrap.ts` via `actionProvider.registerMany`, section `plugins`.

| uid | Display name | Status | Default assignment |
|-----|--------------|--------|--------------------|
| `chat.use` | Use AI Content Studio chat | existing | editor roles, granted by the project |
| `settings.read` | Read AI Content Studio settings | existing | super-admin only |
| `settings.update` | Update AI Content Studio settings | existing | super-admin only |
| `audit.run` | **Run AI Content Studio security audit** | **new** | super-admin only (FR-048, D3) |

No other action is added. Functional QA needs no new action — it is bounded by the caller's existing
read permissions (FR-043).

## Enforcement matrix

| Capability | Gate 1 (route/tool exists) | Gate 2 (caller ability) | Gate 3 (at the moment of effect) |
|------------|---------------------------|-------------------------|----------------------------------|
| Open chat, list/read own threads | `admin::isAuthenticatedAdmin` + `chat.use` | thread `ownerId === user.id`, else 404 | — |
| Read content via tools | tool built for the mode | `permission-checker.can.read(uid)` per call | — |
| Propose a change | `proposeChanges` built (not in `audit` mode) | `can.<action>(uid)` per item; denied items returned in `blocked` | — |
| Apply a change | apply route + `chat.use` + owner | re-check `can.<action>(uid)` per item | `baseFingerprint` match + destructive confirmation |
| Publish | as apply | `can.publish(uid)` + type uses draft & publish | as apply |
| Ingest an attachment | ingest route + `chat.use` | Media Library create permission | idempotency key |
| Run QA scan | `audit` mode | `can.read(uid)` per inspected type; skipped types listed | — |
| Run security audit | `audit` mode | **`audit.run`** — else refuse with no partial findings | — |
| Open a preview | preview route + `chat.use` + owner | change set `pending` and owned by caller | signed token, TTL, `pending`-only |
| Read/write settings | `is-super-admin` policy (unchanged) | `settings.read` / `settings.update` | — |

## Invariants

1. **The assistant can never exceed the caller.** Every content read is checked per call; every write
   is checked twice — once when proposed, once when applied — against the caller's live ability
   (Constitution II). No ability is cached across requests or users.
2. **Modes only narrow.** A mode may remove a tool; it may never grant a capability the caller lacks
   (FR-031).
3. **Ownership is server-derived.** `ownerId` comes from `ctx.state.user.id`. A body-supplied owner,
   thread, or change-set owner is ignored. Cross-owner access is `404` so ids are not enumerable.
4. **Super-admin is not exempt from thread privacy.** Conversations are private to their owner
   (FR-017). This is intentionally stricter than Strapi's usual super-admin reach and must be stated in
   the README.
5. **The only write path is the apply route.** There is no code path from a model tool to the Document
   Service that mutates content. A future tool that writes directly is a constitution violation, not a
   feature.
6. **Audit output is need-to-know.** Refusal for a caller without `audit.run` discloses nothing —
   no counts, no categories, no partial list (FR-048).
7. **Secrets are masked at the tool boundary**, before the result reaches the model, the transcript, or
   a log line (FR-049, Constitution I).

## Permission-denied paths to exercise manually

Constitution V requires at least one denied path per capability that changes content. The minimum set,
each expected to fail cleanly with a plain-language reason and no partial effect:

| # | Setup | Expected |
|---|-------|----------|
| 1 | Editor without update permission on a type asks for a change | item appears under `blocked`; approval cannot include it |
| 2 | Permission revoked after the plan is shown, then approve | apply blocks the item at gate 2, nothing written |
| 3 | User B calls `GET /threads/<A's id>` | `404`, no data |
| 4 | User B calls `POST /change-sets/<A's id>/apply` | `404`, nothing written |
| 5 | Editor without upload permission approves a plan containing ingestion | `403 permission_denied`, no file in the library, no content change |
| 6 | Editor without `audit.run` asks for a security audit in audit mode | refusal, zero findings disclosed |
| 7 | Any user asks for a content change in `audit` mode | refused; no `proposeChanges` tool exists in that mode |
| 8 | Non-super-admin `GET /settings` | `403` (existing behaviour, re-verified) |
| 9 | Anonymous request to a previewed page without the token | live published content only |
| 10 | Expired or tampered preview token on a content-API request | token ignored, live content returned, page still renders |
