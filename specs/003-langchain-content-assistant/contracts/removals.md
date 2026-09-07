# Contract: Removals & Breaking Changes

**Feature**: `specs/003-langchain-content-assistant` | Covers FR-012..FR-017, FR-053, FR-054

Everything this feature takes away, what a consumer must do about it, and the one thing that is
deliberately *not* removed.

---

## 1. The mode selector and the two extra modes

| Removed | Where |
|---|---|
| The mode dropdown above the conversation list | `admin/src/components/ModeSelect.tsx` — **deleted** |
| `mode`, `setMode`, `modeRef`, `changeMode` | `admin/src/hooks/useThreads.ts` |
| The `mode` field in the chat transport body | `admin/src/pages/Chat.tsx` |
| The mode-conditional composer hint | `admin/src/pages/Chat.tsx` / `Composer.tsx` — the hint always speaks about approval (FR-017) |
| `mode` resolution, `setMode`, `modeAtSend` passing | `server/src/services/threads.ts`, `server/src/controllers/chat.ts` |
| `mode` in the chat request schema | `server/src/controllers/chat.ts` |
| `CHAT_MODES`, `ChatMode` | `server/src/types.ts` |
| `MODE_SECTION`, `CONTENT_MODE`, `LAYOUT_MODE`, `AUDIT_MODE` | `server/src/services/prompt.ts` — deleted outright, not folded into a single "mode" heading |
| The `mode` parameter of `buildTools` | `server/src/services/tools.ts` |

**No user-visible text may refer to modes, mode switching, or a mode's limitations** (FR-017). Verify
by reading the built strings, not only by grepping for the word "mode" — a paraphrase survives a grep.

### The tool set becomes one set

`listContentTypes`, `searchEntries`, `getEntry`, `describePageStructure`, `proposeChanges`.

`describePageStructure` becomes **unconditional**. It was gated to `layout` and `audit`; FR-014
requires structure discovery in the only mode there is, so a question about where a page's media or
sections live is answerable with no mode switch (US2-4).

No capability in this mode writes content: the assistant proposes, the editor approves, application
happens through the existing approval path (FR-015).

---

## 2. The audit capability — retired outright

| Removed | Note |
|---|---|
| `server/src/services/audit-qa.ts` | deleted |
| `server/src/services/audit-security.ts` | deleted |
| `server/src/policies/has-audit-permission.ts` | deleted — already unreferenced by any route |
| `admin/src/components/AuditReportCard.tsx` | deleted |
| `runQaScan`, `runSecurityAudit` tools | deleted |
| `AuditKind`, `AuditSeverity`, `AuditCategory`, `AuditLocation`, `AuditFinding`, `AuditCoverage`, `AuditReport`, `AuditOptions` | deleted from `server/src/types.ts` |
| `audit` config key, `getAuditOptions()` | deleted from `server/src/config/index.ts`, `server/src/services/config.ts` |
| `plugin::ai-content-studio.audit.run` permission action | unregistered in `server/src/bootstrap.ts` |
| The `AUDIT_MODE` prompt section | deleted |
| The audit-report branch in `MessageList.tsx` | deleted |
| `'audit-qa'` / `'audit-security'` service registrations | removed from `server/src/services/index.ts` |
| `'has-audit-permission'` policy registration | removed from `server/src/policies/index.ts` |

**No unreachable remnant may be left in the product** (FR-016). That includes the service registry,
the policy registry, the type surface and the config surface — a dead service that still registers is
a remnant.

### The retirement must be spoken, not silent

The instructions gain a `retired` section (see [instructions.md](instructions.md) §1, section 7): a
request for a QA scan or a security audit is answered plainly that the capability is no longer
offered. It is **never silently missing**, and no substitute is improvised (US2-5).

### Stored history still replays

A conversation containing a `runQaScan` or `runSecurityAudit` tool part opens and replays. With the
card gone, the part falls through to the generic tool pill ("Used runQaScan") — it reads as something
that happened, **without implying the capability is still available**. No migration; no stored
transcript is rewritten.

### Upgrade safety

A role that was granted `audit.run` does **not** break the upgrade: a stored grant for a
no-longer-registered action is inert. Nothing to migrate, nothing to clean up.

---

## 3. What is deliberately NOT removed

| Kept | Why |
|---|---|
| `chat-thread.mode` column | A `required` enumeration on live consumer databases. Removing it is a migration risk for no behavioural gain, and the spec's own assumption is that legacy values are **ignored, not migrated**. Marked vestigial in the schema description so the next reader does not mistake it for live state |
| `chat-message.modeAtSend` column | Same. New rows take its existing schema default |
| The `publish` **operation** on a change item | The assistant may still propose a publish, and approving it publishes — that path is untouched (FR-051). What was missing was an *editor-initiated* way to take a reviewed plan live |
| `ai` (the AI SDK package) | It is the wire and storage format: `pipeUIMessageStreamToResponse`, `readUIMessageStream`, and the `UIMessage`/`UIMessageChunk` types. Removing it would change `chat-message.parts` and break FR-013 |
| `@ai-sdk/react` | `useChat` on the admin side, unchanged. The client is not modified for the provider swap |
| `admin/src/data/models.ts` structure and formatting | `.claude/hooks/session-model-context.mjs` parses it as text to end of file. The new provider catalog goes in a **separate** module (research D15) |
| Everything the previous features guaranteed | Nothing is written without approval; a plan expires; previews are owner-scoped and expiring; attachments stay held in the browser until an approval ingests them; permission checks are re-derived per request |

---

## 4. Removed dependencies

| Removed | Why |
|---|---|
| `@ai-sdk/anthropic` | No longer imported — providers come from `@langchain/*` |
| `@ai-sdk/openai` | Same |
| `@ai-sdk/google` | Same |

All three leave `devDependencies` and therefore leave `dist/`, which partly offsets the arriving
LangChain tree (research D8).

---

## 5. README obligations

Both requirements below are satisfied in the same change that makes the removal (FR-053, FR-054).

**FR-053 — documentation updated for:**

- which providers ship and how a provider is configured, including the base-URL field and that a
  provider the layer supports but the distribution does not carry is absent rather than broken;
- the removal of the extra modes;
- the grounding setting, its default (**on**), what it embeds, and that it authorizes nothing;
- the new approval action and what its confirmation means.

**FR-054 — every removed permission action or capability documented as a breaking change**, naming
the version that removes it and what a consumer who granted it should do:

| Breaking change | What a consumer does |
|---|---|
| `plugin::ai-content-studio.audit.run` no longer registered | Nothing is required — the stored grant is inert. Remove it from any role where it was granted for tidiness |
| The QA scan and security audit capabilities are gone | No replacement is planned in the panel. The capability is retired, not moved |
| Layout Mapping and Code Audit modes are gone | Nothing is required — existing conversations open and continue as content editing |
| The `audit` plugin config key is ignored | Remove it from `config/plugins.ts`. An unknown key is harmless, but it no longer does anything |

Also documented, though not a removal: the encryption-key rotation consequence stays on the page
(Principle I), and the constitution amendment (research D16) is recorded in its own `docs:` commit
rather than in the README.
