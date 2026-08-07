# Quickstart: validating this feature

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-08-07

This project has no automated test suite, so this file **is** the quality gate (Constitution V). Run it
in a real Strapi admin panel. Every scenario names the requirement and success criterion it proves, and
each is written to be checked in a few minutes.

---

## Prerequisites

A host Strapi v5 project with this plugin linked from a local checkout:

```bash
# in the plugin checkout
corepack pnpm@10 install
corepack pnpm@10 run build          # dist/ must be current — the host loads dist/server
corepack pnpm@10 run watch          # optional, rebuild on change (restart the host for server changes)

# in the host project
pnpm add link:../strapi-plugin-ai-content-studio
pnpm run develop
```

Host project requirements:

- `AI_STUDIO_ENC_KEY` set (32 bytes base64) and a working provider key saved in
  **Settings → AI Content Studio**.
- At least one collection type with a text field, a single media field, a repeatable component with a
  media slot, and draft & publish enabled — plus 2–3 entries.
- Three admin accounts: **A** (super-admin), **B** (editor with `chat.use` + full content permissions
  on that type), **C** (editor with `chat.use` but *no* update permission on that type and no
  `audit.run`).
- For the preview scenarios only: a front-end that reads `?aiStudioPreview` and forwards it per
  [contracts/preview-integration.md](./contracts/preview-integration.md), plus
  `preview.enabled: true`, `preview.baseUrl`, and a `preview.paths` entry for the type.

Before each verification round:

```bash
corepack pnpm@10 run typecheck      # must be clean (Constitution, per-commit gate 1)
corepack pnpm@10 run build          # dist/ staged with the source change (gate 2)
```

---

## 1 — Change plan, approve, reject *(US1 · FR-001..FR-008 · SC-001, SC-003)*

1. As **B**, ask: *"Change the hero headline on <entry> to 'Bathrooms built around you' and set its
   summary to 'Handmade, fitted in a week'."*
2. **Expect** a plan listing two items with current → proposed values and the resulting draft/published
   state. **Open the entry in the Content Manager: it is unchanged.**
3. Reject. **Expect** confirmation that nothing was applied; entry still unchanged.
4. Ask again, then approve only the headline item. **Expect** the headline applied, the summary
   untouched, and a report naming field, old value, new value, draft/published state.
5. Ask for a change that clears a field. **Expect** the item marked destructive and a separate explicit
   confirmation before it can apply.

**Fails if**: anything is written before approval, an unapproved item is applied, or the report omits
old/new values.

## 2 — Stale plan and revoked permission *(FR-004, FR-005 · edge cases)*

1. As **B**, get a plan for a field. Before approving, edit that same field in the Content Manager.
2. Approve. **Expect** the item reported `stale`, the manual edit intact, and an offer to re-plan.
3. Get a fresh plan. As **A**, remove **B**'s update permission on that type. As **B**, approve.
4. **Expect** the item blocked with a permission reason and nothing written.

## 3 — Front-end preview *(US2 · FR-010..FR-015 · SC-002, SC-004)*

1. As **B**, propose a headline change **and** a hero image change using an attached image.
2. Open the preview. **Expect** the site rendering the new headline *and* the attached image, while the
   Content Manager entry and the Media Library are both unchanged.
3. In a private window with no token, load the same page. **Expect** the old, published content.
4. As **C** (or with a tampered token), request the previewed URL. **Expect** live content, page renders,
   no proposed values.
5. Reject the plan, reload the preview URL. **Expect** live content — the session is revoked.
6. Set `preview.enabled: false`, restart, ask to preview. **Expect** the in-panel before/after
   comparison and a clear message, with approval still possible.

**Fails if**: the proposed values are visible without a valid token, the preview writes anything, or a
missing preview target blocks approval.

## 4 — Thread persistence and isolation *(US3 · FR-016..FR-022 · SC-005, SC-006)*

1. As **B**, hold a 3-turn conversation, then hard-reload the panel.
2. **Expect** the thread in the sidebar with its full history and its plan cards intact, within a few
   seconds.
3. Send *"now do the same for <other entry>"*. **Expect** the assistant to resolve "the same" from
   earlier context.
4. Restart the host Strapi process. **Expect** the thread still there.
5. As **C**, list threads and try **B**'s thread id directly. **Expect** only C's own threads, and
   `404` for B's — including as **A** (super-admin gets no exemption).
6. Rename and delete a thread. **Expect** the rename to persist and the delete to remove its messages,
   plans, and previews.

## 5 — Stop mid-generation *(US4 · FR-023..FR-026 · SC-007)*

1. As **B**, ask for something long: *"Review every entry of <type> and propose consistent headlines."*
2. Press Stop while text is streaming. **Expect** output to halt within ~2 seconds and the composer to
   accept a new message immediately.
3. Watch the host's server log. **Expect** no further tool calls after the press.
4. Reload the thread. **Expect** the partial assistant message present and marked interrupted.

## 6 — Modes *(US5 · FR-027..FR-031 · SC-008)*

1. Switch the thread to **Code Audit** and ask for a content change. **Expect** a refusal explaining the
   mode is read-only and how to switch; nothing written; no plan created.
2. Reload the panel. **Expect** the thread still in Code Audit.
3. Switch to **Layout Mapping** and ask which sections of a page accept images. **Expect** the sections
   and their media slots.
4. Create a new thread. **Expect** Content Editing.

## 7 — Deferred attachments *(US6 · FR-032..FR-039 · SC-009, SC-010)*

1. As **B**, attach two images and a PDF and send *"image #1 to the hero, image #2 to the info section,
   link the PDF on the downloads block."*
2. **Check the Media Library: nothing new.** Expect the plan to map each ordinal to the target the
   instruction named, with any unmappable instruction flagged rather than guessed.
3. Reject. **Expect** the Media Library still unchanged.
4. Repeat and approve. **Expect** exactly three new files, each linked to its target, reported with ids.
5. Approve again / retry after a forced network error. **Expect** no duplicate files.
6. Attach a file larger than the host's upload size limit. **Expect** rejection *before* sending, naming
   the reason.
7. Switch to a non-vision model and attach an image. **Expect** the assistant to say it cannot analyse
   it visually, yet still place it correctly.
8. Attach files, reload before approving, reopen the thread. **Expect** them shown as expired with an
   invitation to re-attach, and nothing in the Media Library.
9. Say *"upload these to the media library"* and confirm. **Expect** ingestion with ids and **no**
   document modified.

## 8 — QA scan *(US7 · FR-040..FR-045 · SC-011, SC-012)*

Seed defects first: delete a related document to dangle a relation; delete a file referenced by a media
field; empty a required field on an existing entry; leave one single type uncreated.

1. As **B** in Code Audit mode, ask for a QA pass.
2. **Expect** each seeded defect reported with content type, document, field, severity, why it breaks,
   and a suggested fix; findings grouped by severity with counts; a coverage statement.
3. **Expect** nothing modified — re-check the entries afterwards.
4. As **C**, run it. **Expect** only readable types inspected and the rest listed as skipped for
   permissions.
5. Run on a clean type. **Expect** no findings rather than invented ones.
6. Confirm the pass returns inside its time budget and states anything it did not reach.

## 9 — Security audit *(US8 · FR-046..FR-050 · SC-013, SC-014)*

Seed: grant the public role `update` on a content type; set `showProviderErrorDetails: true`; put a
fake `sk-ant-`-shaped string in a text field.

1. As **A** in Code Audit mode, ask for a security audit.
2. **Expect** the public-role write reported high severity with role, type, action, and remediation; the
   debug setting reported as a production risk; the secret-like value reported **masked** with its
   location.
3. Search the whole report and the host's server log for the fake key. **Expect** zero plaintext
   occurrences.
4. As **C** (no `audit.run`), ask for the audit. **Expect** a refusal with no counts, categories, or
   partial findings.
5. Ask the assistant to fix a finding. **Expect** a normal change plan requiring approval — never a
   direct fix.

## 10 — Upgrade safety and degradation *(FR-051..FR-054 · SC-016)*

1. Start from a host project with the **previous** plugin version and existing settings, then link this
   version and restart.
2. **Expect** boot to succeed with no new required env var, existing provider settings intact, and chat
   working with preview simply unavailable (default `preview.enabled: false`).
3. Switch provider (Anthropic → Google → OpenAI) and repeat scenarios 1, 5 and 7. **Expect** plans,
   apply, stop, and attachment placement to behave identically; only visual image analysis varies, and
   that is stated in the UI.
4. Confirm the README documents: the new `audit.run` permission, the preview configuration and
   front-end contract, thread privacy (super-admin included), and the v1 limitations (no GraphQL
   overlay, staged media single-instance, held attachments lost on reload).

---

## Sign-off checklist

- [ ] `pnpm run typecheck` clean
- [ ] `pnpm run build` run and `dist/` staged with the source change
- [ ] Scenarios 1–10 executed on a real admin panel
- [ ] All 10 permission-denied paths in [contracts/permissions.md](./contracts/permissions.md#permission-denied-paths-to-exercise-manually) exercised
- [ ] No plaintext secret in any report, response, or log line
- [ ] README updated in the same change
