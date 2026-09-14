/**
 * Shared feature types for the provider / instruction / grounding / change-plan / preview /
 * attachment surfaces.
 *
 * These describe the JSON columns and tool payloads that cross the service -> controller ->
 * route boundary, so they live here rather than in any one service. Nothing here is `any`.
 *
 * The persisted-settings shapes (`StudioSettings`, `ProviderState`, and their masked views) stay
 * in `services/config.ts`, which owns their normalization — they are imported from there rather
 * than duplicated here.
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

/*
 * `CHAT_MODES` and `ChatMode` are GONE (contracts/removals.md §1). There is one mode, so there is
 * nothing to name. The two enumeration COLUMNS remain — `chat-thread.mode` and
 * `chat-message.modeAtSend` — because they are required enumerations on live consumer databases and
 * removing one is a migration risk for no behavioural gain. They are marked vestigial in their own
 * schema descriptions; nothing reads them, so the types go (research D12).
 */

/* -------------------------------------------------------------- providers */

/**
 * One provider the adapter layer can reach AND the distribution ships (data-model §1).
 *
 * The table of these in `services/providers.ts` is the whole provider surface: nothing else in the
 * repository knows a provider's name, and adding one is a static import plus one row (FR-002).
 * `create` is the ONLY provider-shaped code in the repository.
 */
export interface ProviderDescriptor {
  /** Stable, lowercase, kebab-case. Persisted in settings and used as the map key. NEVER renamed
   *  once shipped — a rename orphans an install's saved selection. */
  id: string;
  /** English display name (FR-025). */
  label: string;
  /**
   * Statically imported constructor, wrapped. Receives an ALREADY-DECRYPTED key and returns
   * immediately: it performs no network call, so a configuration error stays distinguishable from
   * a provider error (FR-010). Never a dynamic import (research D2).
   */
  create: (input: { apiKey: string; model: string; baseUrl: string | null }) => BaseChatModel;
  /** `true` only for the OpenAI-compatible provider. A saved configuration without a valid base
   *  URL is then a configuration failure surfaced BEFORE generation (FR-010). */
  requiresBaseUrl: boolean;
  /**
   * Declared per provider, DEFAULT-DENY (FR-006). Replaces the single prefix-matching
   * `modelSupportsVision()`. The rules are ported verbatim from it — image input works on all
   * three first-party providers today, and a descriptor left at bare default-deny would remove
   * that silently while passing every negative test.
   */
  supportsVision: (model: string) => boolean;
}

/* ----------------------------------------------------------- instructions */

/** The declared section ids, in the fixed order of contracts/instructions.md §1. */
export const INSTRUCTION_SECTION_IDS = [
  'role',
  // 2. Immediately after `role`, because which language to answer in is a property of BEING the
  //    assistant rather than a rule about one of its activities (005 contracts/language.md §1).
  'language',
  'discovery',
  'permissions',
  'ambiguity',
  'proposing',
  'tool-honesty',
  /*
   * Where a claim about content came from (005 FR-008, FR-010..FR-012). After `tool-honesty`, which
   * it extends: that governs how a result is REPORTED, this governs what may be asserted when there
   * is no result at all.
   */
  'attribution',
  'retired',
  'style',
  'attachments',
  'attachments-blind',
  'install',
  /*
   * The briefing, after `install` so the schema facts frame the prose rather than the other way
   * round — and SPLIT IN TWO by feature 005, replacing the single `brief` section.
   *
   * `brief` carried every per-content-type section as ambient prose, which is where 004's factual
   * claims about content lived and therefore where hallucination actually happened: a section
   * written from 4 entries out of 9,000 read exactly like one written from a complete reading. Those
   * sections are now RETRIEVED by an explicit tool call (FR-031); what stays ambient is the
   * project overview, bounded away from any claim about a specific entry (FR-036), and an INDEX of
   * names and numbers that carries no prose at all (FR-032).
   */
  'brief-overview',
  'brief-index',
  /*
   * Facts about the CURRENT REQUEST — the editor's interface language, their Focus, whether a plan
   * is awaiting their decision (005 contracts/situation-and-focus.md §2). Last before `condensed`,
   * so it is read against every rule and every generated fact above it rather than framing them.
   * Per-request, therefore NOT hashed.
   */
  'situation',
  'condensed',
] as const;

export type InstructionSectionId = (typeof INSTRUCTION_SECTION_IDS)[number];

/**
 * The ONLY language signal the SERVER resolves (005 data-model §1).
 *
 * NOT PERSISTED, and there is nothing to persist: FR-001 makes the reply language a function of the
 * editor's most recent message, so a stored value could only ever disagree with the message in
 * front of the model. The message's own language is the model's to read; this is the fallback for
 * when it cannot.
 *
 * Precedence — explicit request, then the most recent message, then this, then English — is stated
 * in the `language` instruction section rather than computed here. Only the last two are facts the
 * server holds; the first two are properties of text only the model sees.
 */
export interface LanguageSignal {
  /**
   * `ctx.state.user.preferedLanguage` — Strapi's own spelling, a declared string attribute on
   * `admin::user`, already loaded onto `ctx.state.user` by the admin auth strategy. So it costs no
   * extra query. Null when the account has never set one.
   */
  interfaceLanguage: string | null;
}

/**
 * The composed system instructions for one request (data-model §4).
 *
 * `text` is byte-for-byte identical for identical request inputs (FR-018), and `version` is
 * DERIVED from the behavioural section text rather than maintained by hand, which is how FR-026 is
 * satisfied structurally: a single changed character changes it, and it cannot be changed without
 * editing the text.
 */
export interface InstructionSet {
  /** `v<N>-<first 8 hex of sha256(behavioural sections)>`, computed at module load. The install
   *  description is EXCLUDED from the hash (research D10). */
  version: string;
  text: string;
  /** Which sections were included, in order — the inspector renders this alongside the text. */
  sections: readonly InstructionSectionId[];
  /** False when grounding is off (FR-036) or the caller can read nothing. */
  groundingIncluded: boolean;
  /** True when the description was shortened to fit its budget (FR-032). */
  groundingPartial: boolean;
}

/* -------------------------------------------------------------- grounding */

/** Deterministic degradation tiers, applied by the same rule every time (FR-032). */
export type GroundingTier = 'full' | 'no-components' | 'names-only' | 'index';

/**
 * Generated structural facts about the running install (data-model §5).
 *
 * Contains NO content, no entry values, no media URLs, no user data, nothing secret-like (FR-029).
 * Derived only from the running instance's schema and the plugin's own configuration — never from
 * the host application's source code (FR-028).
 */
export interface InstallDescription {
  /** The exact text embedded in the instructions, and the exact text the inspector shows (FR-035). */
  text: string;
  /** True when a tier below `full` was applied. */
  partial: boolean;
  tier: GroundingTier;
  /** sha256 over the canonically serialized `api::*` schemas plus components. Changes when the
   *  schema changes — the cache key that makes FR-033 work with no restart. */
  schemaFingerprint: string;
  /** sha256 over the caller's SORTED readable-uid list. The only ability input that can change the
   *  output, so the pair is an exact cache key. */
  readableFingerprint: string;
  /** Must never exceed the declared budget (SC-011). */
  charCount: number;
  /** How many content types the caller can read and the description describes. */
  contentTypeCount: number;
  /** How many were dropped from the end of the sorted order to fit the budget. */
  omittedContentTypeCount: number;
}

/* ---------------------------------------------------------- content brief */

/**
 * Which generated context the instructions carry (contracts/content-brief.md §2).
 *
 * `schema` is the deterministic install description; `brief` is the model-written content brief;
 * `both` carries each under its own heading and its own character budget.
 */
export type GroundingSource = 'schema' | 'brief' | 'both';

/** How many entries one run reads per content type. Chosen by an administrator in Settings. */
export type BriefDepth = 'light' | 'standard' | 'deep';

/** Entries sampled per content type, per depth. The only place these numbers are defined. */
export const BRIEF_DEPTH_SAMPLE: Readonly<Record<BriefDepth, number>> = {
  light: 5,
  standard: 15,
  deep: 50,
};

export type BriefRunState = 'never-run' | 'running' | 'ready' | 'failed';

/**
 * One content type's section of the brief.
 *
 * SECTIONED PER CONTENT TYPE ON PURPOSE, and that is a Principle II requirement rather than a
 * storage convenience: the brief is generated once and shared by every account, so the only way it
 * can never tell an account something its own permissions would not is to be assembled per caller
 * from the sections that caller can read. A single blob could not be filtered.
 */
export interface BriefSection {
  uid: string;
  /** The human-readable prose. No JSON, no field dumps — that is what the schema source is for. */
  text: string;
  /** The schema fingerprint at generation time. A change makes this section stale. */
  schemaFingerprint: string;
  /** Entry count + newest `updatedAt`, hashed. A change makes this section stale. */
  contentFingerprint: string;
  sampledCount: number;
  totalCount: number;
  generatedAt: string;
  provider: string | null;
  model: string | null;
  /**
   * Which language version the counts above are of (005 FR-040).
   *
   * NULL MEANS "written before language versions were tracked", and never "all of them". The
   * distinction is the point: before this feature a run sampled and counted every translation, so
   * `totalCount` was inflated by the number of locales — a section written from 4 of 9,000 rows
   * could be 4 of 3,000 entries in three languages. A null here says the number cannot be read that
   * finely, rather than quietly asserting a coverage that was never measured.
   */
  locale: string | null;
  /** Whether rendered-page analysis informed this section (005 FR-026). */
  pageInformed: boolean;
  pageUrl: string | null;
  pageLocale: string | null;
}

/**
 * How well supported one stored section is — the derived view BOTH surfaces use (005 data-model §4.3).
 *
 * THE DEFECT THIS EXISTS TO FIX. `sampledCount` and `totalCount` were stored and then discarded
 * before the assistant ever saw them, so a section written from 4 entries out of 9,000 arrived
 * looking exactly like one written from a complete reading. The assistant had no way to tell a
 * well-supported description from a guess, and neither did the editor reading its answer.
 */
export interface BriefCoverage {
  sampledCount: number;
  totalCount: number;
  /** Null means "written before language versions were tracked", never "all of them". */
  locale: string | null;
  generatedAt: string;
  /** LIVE: the schema or content fingerprint has moved since the section was written. */
  stale: boolean;
  /**
   * FR-013. DERIVED, NEVER STORED — a stored `weak` would be a snapshot of a judgement whose inputs
   * (the live fingerprints, the current entry count) move underneath it.
   *
   * True when the content type is now EMPTY, when the section is STALE, or when
   * `sampledCount / totalCount` falls below the stated constant in `content-brief.ts`. A weak
   * section is returned LABELLED — never withheld, and never flattened into an ordinary one.
   */
  weak: boolean;
  pageInformed: boolean;
}

/**
 * One ambient line per content type that has a stored section (005 FR-032).
 *
 * THE INVARIANT IS THE WHOLE ENTITY: an index entry carries NO SECTION TEXT. It exists so the
 * assistant can judge whether a section is worth retrieving before it spends the call — and a line
 * of prose here would quietly restore the ambient claims FR-031 removed, making the index a second
 * copy of the briefing.
 */
export interface BriefIndexEntry {
  uid: string;
  displayName: string;
  coverage: BriefCoverage;
}

/* -------------------------------------------------------- page reading */

/**
 * One landmark region or heading of a rendered page (005 data-model §7).
 *
 * WHY REGIONS AND NOT JUST TEXT. The schema says a `page` has a `hero` with an `image`; a sample of
 * entries says that image is usually populated. Neither can say the hero is the page's LEAD region,
 * or that the component named `block-c` is the testimonial carousel. That meaning exists only in
 * the rendered output's structure, which is what this captures.
 */
export interface PageRegion {
  /** `header` | `nav` | `main` | `article` | `section` | `aside` | `footer`, or a heading level. */
  role: string;
  /** The region's heading or accessible name, where it has one. */
  label: string | null;
  /** Bounded plain text. Never reaches a stored section verbatim. */
  text: string;
  order: number;
}

/**
 * What one page read produced. ⚠ DELIBERATELY NEVER PERSISTED, and that absence IS the mechanism
 * behind FR-025.
 *
 * A redaction filter is a second-best guarantee that has to be right about every pattern it has
 * never seen. NOT KEEPING THE DATA is a first-best one. This is input to one model call and is then
 * gone; only the model's prose reaches a row — the same guarantee feature 004 already relies on for
 * entry values.
 */
export interface PageReading {
  url: string;
  /** Which language version was read, or null when the front end could not distinguish one. */
  locale: string | null;
  title: string | null;
  regions: PageRegion[];
  text: string;
  truncated: boolean;
}

/**
 * Why a page could not be read. EVERY ONE OF THESE DEGRADES THE SECTION TO ENTRY-ONLY and must
 * never fail the section, the run, or a chat turn (FR-023).
 */
export type PageReadingFailure =
  /** Preview off, no path pattern, or the pattern cannot be filled from this entry. */
  | 'not_configured'
  /** The URL, or a redirect, left the configured front-end origin. */
  | 'origin_mismatch'
  /** DNS, connection refused, non-2xx. */
  | 'unreachable'
  | 'timeout'
  | 'too_large'
  | 'not_html'
  /** A script shell with nothing to read — treated exactly as unreachable (US4-4). */
  | 'no_readable_text';

/** The run-level state, held in the plugin store rather than in a row — it is not content. */
export interface BriefRun {
  state: BriefRunState;
  depth: BriefDepth;
  /**
   * The whole-platform paragraph: what this project IS, written from the finished sections.
   *
   * Stored on the RUN rather than as a row, because it is a property of a run rather than of any
   * one content type — there is no uid it could be keyed by, and it is rewritten whole every time.
   */
  overview: string | null;
  startedAt: string | null;
  completedAt: string | null;
  /** Which uid the run is on, so the settings page can show real progress. */
  currentUid: string | null;
  doneCount: number;
  totalCount: number;
  /** Redacted. A provider error never reaches here unmasked (Principle I). */
  error: string | null;
  lastRunByUserId: number | null;
  /** Throttle floor for the automatic refresh — never a floor for a human pressing Run. */
  lastAutoRefreshAt: string | null;
  /**
   * Which content types fell back to an entry-only section on the last run, and why (005 FR-023,
   * SC-012).
   *
   * DEGRADATION IS RECORDED, NEVER HIDDEN. An operator who turned page reading on and got no
   * benefit must be able to see which content types it could not reach and what stopped it —
   * otherwise the capability fails silently, which is the one outcome that makes it untrustworthy.
   *
   * Defaulted to `[]` by `normalizeBriefRun`, so a run record written by an older build still reads.
   */
  pageReadingFailures: Array<{ uid: string; reason: PageReadingFailure }>;
}

/* --------------------------------------------------------------- focus */

/**
 * The one entry an editor has pointed at, stored on the conversation (005 data-model §2.2).
 *
 * FOCUS IS SET BY THE EDITOR, NEVER OBSERVED. The plugin does not watch Content Manager navigation:
 * that would bind this plugin's behaviour to admin internals that shift across Strapi upgrades, and
 * it would silently assume a wrong entry. One deliberate action buys "this page", "the heading",
 * "that image" resolving without being named again — and an editor who has set none is ASKED, never
 * guessed at.
 */
export interface ThreadFocus {
  /** Content-type uid. Validated against the live `api::*` allow-list on WRITE AND ON READ. */
  uid: string;
  /** Null for single types. */
  documentId: string | null;
  /** The language version the editor means. Null when the type is not localized (FR-042). */
  locale: string | null;
  /**
   * Display snapshot for the panel and the situation block. NEVER THE BASIS FOR A CLAIM: it is a
   * label recorded at set time, and the entry may have been retitled or deleted since.
   */
  label: string;
  setAt: string;
}

/**
 * How a stored focus resolves THIS TURN. Re-resolved every time, never trusted as stored.
 *
 * THREE OF THE FOUR ARE NOT FAILURES (FR-019). An absent, stale, deleted or unreadable focus must
 * never fail a turn — it changes what the assistant says, not whether it answers.
 */
export type FocusResolution =
  /** uid still valid, caller may read it, the document (and locale version) exists. */
  | { state: 'set'; focus: ThreadFocus }
  /**
   * The caller's `can.read(uid)` is false. Carries NOTHING about the entry — no label, no
   * documentId, no uid contents — because revealing any of it through a focus the caller cannot
   * read would be exactly the disclosure SC-008 forbids.
   */
  | { state: 'unreadable' }
  /** The document, or that locale version, no longer exists (FR-044). */
  | { state: 'missing' }
  /** No focus stored. "This page" must be asked about rather than guessed (US3-2). */
  | { state: 'none' };

/**
 * A plan awaiting the editor's decision, so "the plan" resolves without them restating it (FR-035).
 *
 * NOT PERSISTED — the change set already carries all of it. Resolved per request from the caller's
 * own pending, unexpired change sets in this thread, and it changes NOTHING about approval: the plan
 * is still applied only by the editor's click on the apply route (FR-034).
 */
export interface PendingPlanFact {
  changeSetId: string;
  summary: string | null;
  itemCount: number;
  expiresAt: string;
}

/* --------------------------------------------------------- change sets */

export type ChangeOperation = 'create' | 'update' | 'publish' | 'ingestAttachment';

export type ResultingState = 'draft' | 'published' | 'unchanged';

export type PermissionVerdict = 'allowed' | 'denied';

export type ChangeItemOutcomeState = 'applied' | 'blocked' | 'stale' | 'failed' | 'skipped';

/**
 * Per-field staleness fingerprint captured when the plan is generated (R10). Apply re-reads and
 * compares: an unrelated edit elsewhere in the document does not block the item, but a genuine
 * conflict on the SAME field always does.
 */
export interface ChangeFingerprint {
  /** The target document's `updatedAt` at propose time, or null when it had none. */
  updatedAt: string | null;
  /** Hash of the current value of exactly the field this item touches. */
  fieldHash: string;
}

/**
 * The outcome of one document's publish attempt (data-model §7).
 *
 * Publish is DOCUMENT-scoped but reported PER ITEM: two field changes on one document produce one
 * publish call, whose outcome is attributed to each contributing item, so the report reads per item
 * as FR-050 requires without publishing twice.
 */
export type PublishOutcomeState =
  /** Published successfully. */
  | 'published'
  /** The caller may not publish this content type — reported with the permission reason, never
   *  skipped silently (FR-046). */
  | 'blocked'
  /** The host refused the publish (e.g. required fields empty) — carries the host's reason. */
  | 'failed'
  /** The content type does not use draft & publish: live on save, no publish attempted (FR-047). */
  | 'not_applicable'
  /** The write phase did not reach `applied`, so no publish was attempted (FR-049). */
  | 'skipped';

export interface PublishOutcome {
  state: PublishOutcomeState;
  /** The permission reason for `blocked` (FR-046) or the host's reason for `failed`. Never
   *  silently dropped. */
  message?: string;
}

export interface ChangeItemOutcome {
  /** The WRITE phase's result. */
  state: ChangeItemOutcomeState;
  message?: string;
  oldValue?: unknown;
  newValue?: unknown;
  /** Present only when the approve-and-publish action ran. */
  publish?: PublishOutcome;
}

/** One proposed modification. Elements of `change-set.items` (a JSON column, not a content type). */
export interface ChangeItem {
  /** Stable within the set — this is what the UI approves by. */
  id: string;
  operation: ChangeOperation;
  contentTypeUid: string;
  /** null for `create` and for single types. */
  documentId: string | null;
  /** Human title, for the plan and the post-apply report. */
  documentLabel: string;
  /** Dotted path for component fields; null for `publish`. */
  field: string | null;
  /** Truncated for display; null for `create`. */
  currentValue: unknown;
  proposedValue: unknown;
  resultingState: ResultingState;
  /** Clears a field, removes a relation, or deletes content (FR-007). */
  destructive: boolean;
  /** Set for `ingestAttachment` and for media fields fed by a held attachment. */
  attachmentOrdinal: number | null;
  /** Evaluated at propose AND re-evaluated at apply (FR-004). */
  permissionVerdict: PermissionVerdict;
  /** Why the verdict is `denied` — surfaced in the plan card, never silently dropped. */
  permissionReason?: string;
  baseFingerprint: ChangeFingerprint | null;
  /** Filled in by apply. */
  outcome: ChangeItemOutcome | null;
}

export type ChangeSetStatus = 'pending' | 'applied' | 'partially_applied' | 'rejected' | 'expired';

/* -------------------------------------------------------- attachments */

/**
 * What the model is told about a held file. Bytes are NOT here — they stay in the browser until
 * the user approves ingestion. The ordinal is the model's only handle on the file (FR-034).
 */
export interface AttachmentManifestEntry {
  /** 1-based, stable for the conversation, never reused after removal. */
  ordinal: number;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

/** Result of ingesting one held file into the Media Library. */
export interface IngestedAttachment {
  ordinal: number;
  mediaId: number;
  name: string;
  url: string;
  /** true when an idempotency-key match returned the existing entry instead of creating one. */
  deduplicated: boolean;
}

/* ------------------------------------------------------------ preview */

/** The signed payload of a preview token. Never stored — verified from the HMAC (R11). */
export interface PreviewTokenPayload {
  sessionId: string;
  ownerId: number;
  changeSetId: string;
  /** Unix seconds. */
  exp: number;
}

/** `{ [contentTypeUid]: { [documentId]: { [dottedField]: value } } }`, precomputed for the middleware. */
export type PreviewOverlay = Record<string, Record<string, Record<string, unknown>>>;

/** Metadata for a staged file; the bytes live in the creating instance's memory. */
export interface StagedFileMeta {
  fileId: string;
  ordinal: number;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}
