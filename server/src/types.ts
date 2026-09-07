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
  'discovery',
  'permissions',
  'ambiguity',
  'proposing',
  'tool-honesty',
  'retired',
  'style',
  'attachments',
  'attachments-blind',
  'install',
  'condensed',
] as const;

export type InstructionSectionId = (typeof INSTRUCTION_SECTION_IDS)[number];

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
export type GroundingTier = 'full' | 'no-components' | 'names-only';

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
