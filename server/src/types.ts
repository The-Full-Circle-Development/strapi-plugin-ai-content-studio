/**
 * Shared feature types for the change-plan / preview / attachment / audit surfaces.
 *
 * These describe the JSON columns and tool payloads that cross the service -> controller ->
 * route boundary, so they live here rather than in any one service. Nothing here is `any`.
 */

/* ------------------------------------------------------------------ modes */

export const CHAT_MODES = ['content', 'layout', 'audit'] as const;
export type ChatMode = (typeof CHAT_MODES)[number];

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

export interface ChangeItemOutcome {
  state: ChangeItemOutcomeState;
  message?: string;
  oldValue?: unknown;
  newValue?: unknown;
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

/* -------------------------------------------------------------- audit */

export type AuditKind = 'qa' | 'security';

export type AuditSeverity = 'critical' | 'high' | 'medium' | 'low';

export type AuditCategory =
  // functional QA (US7)
  | 'dangling-relation'
  | 'missing-media'
  | 'required-empty'
  | 'enum-out-of-range'
  | 'component-broken'
  | 'single-type-missing'
  | 'published-required-empty'
  // security (US8)
  | 'public-write-permission'
  | 'unauthenticated-endpoint'
  | 'role-overbroad'
  | 'unsafe-upload-types'
  | 'debug-setting'
  | 'secret-like-value';

export interface AuditLocation {
  contentTypeUid?: string;
  documentId?: string;
  field?: string;
  configPath?: string;
}

export interface AuditFinding {
  category: AuditCategory;
  severity: AuditSeverity;
  location: AuditLocation;
  /** ALWAYS passed through the redaction helper before the result leaves the tool (FR-049). */
  evidence: string;
  impact: string;
  remediation: string;
}

/**
 * Mandatory coverage statement. A pass that ran out of budget must not read as a clean bill of
 * health (FR-044), and one limited by permissions must say so (FR-043).
 */
export interface AuditCoverage {
  inspected: string[];
  skippedForPermissions: string[];
  skippedForBudget: string[];
}

export interface AuditReport {
  kind: AuditKind;
  runAt: string;
  coverage: AuditCoverage;
  counts: Record<AuditSeverity, number>;
  findings: AuditFinding[];
}
