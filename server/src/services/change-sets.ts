import crypto from 'node:crypto';
import type { Core } from '@strapi/strapi';
import { UID } from '../content-types';
import type {
  ChangeFingerprint,
  ChangeItem,
  ChangeItemOutcome,
  ChangeOperation,
  ChangeSetStatus,
  ResultingState,
} from '../types';

/**
 * Change plans: propose, then apply.
 *
 * This is the structural guarantee behind the whole feature (R1, FR-001). The model can only ever
 * reach `createPending`, which writes a row in this plugin's own table and nothing else. The ONLY
 * code path that touches the Document Service is `apply`, and `apply` is reached from a plain admin
 * route driven by the user's click — never from a tool. There is no path from the model to a
 * content mutation at all.
 *
 * `apply` runs a six-step gate per item, in order. A failure at any step applies NOTHING for that
 * item; other items are unaffected, which is what makes partial application honest.
 */

export interface ProposeItemInput {
  operation: ChangeOperation;
  contentTypeUid: string;
  documentId?: string | null;
  field?: string | null;
  proposedValue?: unknown;
  attachmentOrdinal?: number | null;
}

export interface ProposeResult {
  ok: boolean;
  error?: string;
  message?: string;
  changeSetId?: string;
  status?: ChangeSetStatus;
  expiresAt?: string;
  requiresDestructiveConfirmation?: boolean;
  items?: Array<Partial<ChangeItem>>;
  blocked?: Array<{ field: string | null; contentTypeUid: string; reason: string; message: string }>;
  nextStep?: string;
  candidates?: string[];
}

export interface ApplyResult {
  ok: boolean;
  error?: string;
  message?: string;
  status?: ChangeSetStatus;
  approvedByUserId?: number;
  appliedAt?: string;
  items?: Array<{ id: string; outcome: ChangeItemOutcome }>;
}

/** Actions the content-manager permission-checker understands, per operation. */
const ACTION_FOR: Record<ChangeOperation, 'create' | 'update' | 'publish'> = {
  create: 'create',
  update: 'update',
  publish: 'publish',
  // Ingestion writes to the Media Library, not to a content type; the upload permission is
  // checked separately by the attachments service before any byte is written.
  ingestAttachment: 'update',
};

const MAX_VALUE_CHARS = 600;
const MAX_ITEMS = 50;

const changeSetsService = ({ strapi }: { strapi: Core.Strapi }) => {
  const docs = (uid: string): any => strapi.documents(uid as never);
  const plugin = () => strapi.plugin('ai-content-studio');

  const allowedUids = (): string[] =>
    Object.keys(strapi.contentTypes).filter((uid) => uid.startsWith('api::'));

  const ctOf = (uid: string): any => (strapi.contentTypes as Record<string, any>)[uid];
  const isSingle = (uid: string): boolean => ctOf(uid)?.kind === 'singleType';
  const usesDraftAndPublish = (uid: string): boolean => Boolean(ctOf(uid)?.options?.draftAndPublish);

  const checkerFor = (uid: string, userAbility: unknown): any =>
    strapi.plugin('content-manager').service('permission-checker').create({ userAbility, model: uid });

  const can = (uid: string, action: 'create' | 'update' | 'publish' | 'read', userAbility: unknown): boolean => {
    try {
      return Boolean(checkerFor(uid, userAbility).can[action]());
    } catch {
      return false;
    }
  };

  /** Truncate a value for DISPLAY. The stored proposed value is never truncated. */
  const forDisplay = (value: unknown): unknown => {
    if (typeof value === 'string' && value.length > MAX_VALUE_CHARS) {
      return `${value.slice(0, MAX_VALUE_CHARS)}… [truncated ${value.length - MAX_VALUE_CHARS} chars]`;
    }
    if (value && typeof value === 'object') {
      try {
        const json = JSON.stringify(value);
        if (json.length > MAX_VALUE_CHARS) {
          return `${json.slice(0, MAX_VALUE_CHARS)}… [truncated]`;
        }
      } catch {
        return '[unserializable]';
      }
    }
    return value;
  };

  /** Read a dotted path (`hero.headline`, `sections[1].title`) out of a document. */
  const readPath = (doc: any, path: string | null): unknown => {
    if (!path) {
      return undefined;
    }
    const segments = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
    let cursor: any = doc;
    for (const segment of segments) {
      if (cursor === null || cursor === undefined) {
        return undefined;
      }
      cursor = cursor[segment];
    }
    return cursor;
  };

  /** Write a dotted path into a nested plain object, creating containers as needed. */
  const writePath = (target: Record<string, unknown>, path: string, value: unknown): void => {
    const segments = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
    let cursor: any = target;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const segment = segments[i];
      const nextIsIndex = /^\d+$/.test(segments[i + 1]);
      if (cursor[segment] === undefined || cursor[segment] === null || typeof cursor[segment] !== 'object') {
        cursor[segment] = nextIsIndex ? [] : {};
      }
      cursor = cursor[segment];
    }
    cursor[segments[segments.length - 1]] = value;
  };

  /**
   * Does the dotted path exist on this content type's schema? Component and dynamic-zone
   * boundaries are walked; an array index segment is skipped over.
   */
  const fieldExists = (uid: string, path: string): boolean => {
    const segments = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
    let attributes: Record<string, any> | null = ctOf(uid)?.attributes ?? null;
    for (const segment of segments) {
      if (!attributes) {
        return false;
      }
      if (/^\d+$/.test(segment)) {
        continue;
      }
      const attribute = attributes[segment];
      if (!attribute) {
        return false;
      }
      if (attribute.type === 'component') {
        attributes = (strapi.components as Record<string, any>)[attribute.component]?.attributes ?? null;
      } else if (attribute.type === 'dynamiczone') {
        // Any component in the zone may carry the rest of the path — accept it and let the
        // Document Service validate at apply time rather than refusing a legitimate target.
        return true;
      } else {
        attributes = null;
      }
    }
    return true;
  };

  /** Stable hash of exactly the value this item touches (R10). */
  const hashValue = (value: unknown): string => {
    let serialized: string;
    try {
      serialized = JSON.stringify(value ?? null);
    } catch {
      serialized = String(value);
    }
    return crypto.createHash('sha256').update(serialized).digest('hex').slice(0, 32);
  };

  const fingerprint = (doc: any, field: string | null): ChangeFingerprint => ({
    updatedAt: doc?.updatedAt ? String(doc.updatedAt) : null,
    fieldHash: hashValue(field ? readPath(doc, field) : null),
  });

  /** A human label for the plan and the report. */
  const labelOf = (doc: any, uid: string): string => {
    const candidates = ['title', 'name', 'heading', 'label', 'slug'];
    for (const key of candidates) {
      if (typeof doc?.[key] === 'string' && doc[key].trim() !== '') {
        return doc[key];
      }
    }
    const displayName = ctOf(uid)?.info?.displayName ?? uid;
    return doc?.documentId ? `${displayName} ${doc.documentId}` : displayName;
  };

  /**
   * Destructive = the change removes content rather than replacing it: clearing a field, emptying
   * a relation, or dropping list entries (FR-007).
   */
  const isDestructive = (currentValue: unknown, proposedValue: unknown, operation: ChangeOperation): boolean => {
    if (operation === 'publish' || operation === 'create' || operation === 'ingestAttachment') {
      return false;
    }
    const clearing =
      proposedValue === null ||
      proposedValue === undefined ||
      proposedValue === '' ||
      (Array.isArray(proposedValue) && proposedValue.length === 0);
    const hadValue =
      currentValue !== null &&
      currentValue !== undefined &&
      currentValue !== '' &&
      !(Array.isArray(currentValue) && currentValue.length === 0);
    if (clearing && hadValue) {
      return true;
    }
    // Shrinking a list drops entries, which is a removal even though a value remains.
    return Array.isArray(currentValue) && Array.isArray(proposedValue) && proposedValue.length < currentValue.length;
  };

  const resultingStateOf = (uid: string, operation: ChangeOperation): ResultingState => {
    if (operation === 'publish') {
      return 'published';
    }
    if (operation === 'ingestAttachment') {
      return 'unchanged';
    }
    // A write lands on the draft for draft&publish types; otherwise it is live immediately.
    return usesDraftAndPublish(uid) ? 'draft' : 'published';
  };

  const service = {
    /** Minutes a pending plan stays applicable, from the shared preview TTL. */
    ttlMinutes(): number {
      return plugin().service('config').getPreviewOptions().ttlMinutes;
    },

    /**
     * Persist a pending plan (T020). Validates every item against the live schema and the
     * CALLER's ability, reads current values, and captures a per-field fingerprint.
     *
     * Items the caller may not perform come back under `blocked` — never silently dropped
     * (FR-004) — and cannot be approved later.
     */
    async createPending({
      threadId,
      ownerId,
      userAbility,
      summary,
      items,
      manifestOrdinals = [],
    }: {
      threadId: string;
      ownerId: number;
      userAbility: unknown;
      summary?: string;
      items: ProposeItemInput[];
      manifestOrdinals?: number[];
    }): Promise<ProposeResult> {
      if (!Array.isArray(items) || items.length === 0) {
        return {
          ok: false,
          error: 'empty_plan',
          message: 'No change is needed — say so plainly instead of showing an empty plan.',
        };
      }
      if (items.length > MAX_ITEMS) {
        return {
          ok: false,
          error: 'plan_too_large',
          message: `A plan may contain at most ${MAX_ITEMS} items. Split the work into smaller plans.`,
        };
      }

      const accepted: ChangeItem[] = [];
      const blocked: NonNullable<ProposeResult['blocked']> = [];
      let index = 0;

      for (const raw of items) {
        index += 1;
        const uid = String(raw.contentTypeUid ?? '');
        const field = raw.field ?? null;

        if (!allowedUids().includes(uid)) {
          return {
            ok: false,
            error: 'invalid_content_type',
            message: `Unknown or disallowed content type "${uid}". Call listContentTypes for valid uids.`,
          };
        }
        if (raw.operation === 'publish' && !usesDraftAndPublish(uid)) {
          return {
            ok: false,
            error: 'not_publishable',
            message: `${uid} does not use draft & publish, so it cannot be published.`,
          };
        }
        if (raw.operation === 'update' && !field) {
          return {
            ok: false,
            error: 'unresolved_placement',
            message: `An update to ${uid} names no field. Ask which field to change rather than guessing.`,
            candidates: Object.keys(ctOf(uid)?.attributes ?? {}),
          };
        }
        if (field && !fieldExists(uid, field)) {
          return {
            ok: false,
            error: 'unresolved_placement',
            message: `"${field}" is not a field on ${uid}. Ask the user which target you should use.`,
            candidates: Object.keys(ctOf(uid)?.attributes ?? {}),
          };
        }
        if (typeof raw.attachmentOrdinal === 'number' && !manifestOrdinals.includes(raw.attachmentOrdinal)) {
          return {
            ok: false,
            error: 'unresolved_placement',
            message: `Attachment #${raw.attachmentOrdinal} is not attached to this message. Ask the user to re-attach it.`,
            candidates: manifestOrdinals.map((o) => `#${o}`),
          };
        }

        const action = ACTION_FOR[raw.operation];
        const permitted = can(uid, action, userAbility);

        // Resolve the target document. A single type has exactly one, whatever the model passed.
        let doc: any = null;
        let documentId: string | null = raw.documentId ?? null;
        if (raw.operation !== 'create') {
          try {
            if (isSingle(uid)) {
              doc = await docs(uid).findFirst({ populate: '*' });
              documentId = doc?.documentId ?? null;
            } else if (documentId) {
              doc = await docs(uid).findOne({ documentId, populate: '*' });
            }
          } catch {
            doc = null;
          }
          if (!doc) {
            return {
              ok: false,
              error: 'not_found',
              message: documentId
                ? `No ${uid} with documentId "${documentId}" exists.`
                : `${uid} has not been created yet, so there is nothing to change.`,
            };
          }
        }

        if (!permitted) {
          blocked.push({
            field,
            contentTypeUid: uid,
            reason: 'permission_denied',
            message: `Your account cannot ${action} ${uid}.`,
          });
          // Still recorded, so the plan card can show it as blocked and refuse approval.
          accepted.push({
            id: `i${index}`,
            operation: raw.operation,
            contentTypeUid: uid,
            documentId,
            documentLabel: doc ? labelOf(doc, uid) : ctOf(uid)?.info?.displayName ?? uid,
            field,
            currentValue: doc ? forDisplay(readPath(doc, field)) : null,
            proposedValue: forDisplay(raw.proposedValue),
            resultingState: resultingStateOf(uid, raw.operation),
            destructive: false,
            attachmentOrdinal: raw.attachmentOrdinal ?? null,
            permissionVerdict: 'denied',
            permissionReason: `Your account cannot ${action} ${uid}.`,
            baseFingerprint: null,
            outcome: null,
          });
          continue;
        }

        const currentValue = doc ? readPath(doc, field) : null;
        accepted.push({
          id: `i${index}`,
          operation: raw.operation,
          contentTypeUid: uid,
          documentId,
          documentLabel: doc ? labelOf(doc, uid) : ctOf(uid)?.info?.displayName ?? uid,
          field,
          currentValue: forDisplay(currentValue),
          // Stored untruncated: this is what apply writes.
          proposedValue: raw.proposedValue ?? null,
          resultingState: resultingStateOf(uid, raw.operation),
          destructive: isDestructive(currentValue, raw.proposedValue, raw.operation),
          attachmentOrdinal: raw.attachmentOrdinal ?? null,
          permissionVerdict: 'allowed',
          baseFingerprint: doc ? fingerprint(doc, field) : null,
          outcome: null,
        });
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + service.ttlMinutes() * 60_000).toISOString();
      const created = await docs(UID.changeSet).create({
        data: {
          thread: threadId,
          ownerId,
          status: 'pending',
          items: accepted,
          summary: summary ?? null,
          proposedAt: now.toISOString(),
          expiresAt,
        },
      });

      return {
        ok: true,
        changeSetId: created.documentId,
        status: 'pending',
        expiresAt,
        requiresDestructiveConfirmation: accepted.some((i) => i.destructive && i.permissionVerdict === 'allowed'),
        items: accepted.map((i) => ({
          id: i.id,
          operation: i.operation,
          contentTypeUid: i.contentTypeUid,
          documentId: i.documentId,
          documentLabel: i.documentLabel,
          field: i.field,
          currentValue: i.currentValue,
          proposedValue: forDisplay(i.proposedValue),
          resultingState: i.resultingState,
          destructive: i.destructive,
          attachmentOrdinal: i.attachmentOrdinal,
          permissionVerdict: i.permissionVerdict,
        })),
        blocked,
        nextStep:
          'The user reviews this plan in the panel and approves or rejects it. You cannot apply it. Say plainly that nothing has changed yet.',
      };
    },

    /** Owner-scoped read. Returns null for another user's set so callers answer 404. */
    async getOwned(changeSetId: string, ownerId: number): Promise<any | null> {
      if (!changeSetId || typeof changeSetId !== 'string' || !Number.isInteger(ownerId)) {
        return null;
      }
      const set = await docs(UID.changeSet).findOne({
        documentId: changeSetId,
        populate: { thread: { fields: ['documentId'] } },
      });
      if (!set || set.ownerId !== ownerId) {
        return null;
      }
      return set;
    },

    /** Client-facing shape. Untruncated proposed values never leave the server verbatim. */
    present(set: any): Record<string, unknown> {
      const items: ChangeItem[] = Array.isArray(set.items) ? set.items : [];
      return {
        id: set.documentId,
        threadId: set.thread?.documentId ?? null,
        status: set.status,
        summary: set.summary ?? null,
        proposedAt: set.proposedAt,
        expiresAt: set.expiresAt,
        resolvedAt: set.resolvedAt ?? null,
        hasDestructive: items.some((i) => i.destructive && i.permissionVerdict === 'allowed'),
        destructiveConfirmed: Boolean(set.destructiveConfirmed),
        items: items.map((i) => ({ ...i, proposedValue: forDisplay(i.proposedValue) })),
      };
    },

    /**
     * The ONLY write path (T021). Six-step gate, in order:
     *   1. owned + `pending` + not expired,
     *   2. every itemId exists in the set and is not `denied`,
     *   3. per-item RBAC re-check against the caller's LIVE ability (FR-004),
     *   4. baseFingerprint re-check => `stale`, applying nothing for that item (FR-005),
     *   5. destructive items require explicit confirmation (FR-007),
     *   6. every attachment-fed item has a resolution (an ingested Media Library id).
     */
    async apply({
      changeSetId,
      ownerId,
      userAbility,
      itemIds,
      confirmDestructive = false,
      attachmentResolutions = {},
    }: {
      changeSetId: string;
      ownerId: number;
      userAbility: unknown;
      itemIds: string[];
      confirmDestructive?: boolean;
      attachmentResolutions?: Record<string, number>;
    }): Promise<ApplyResult> {
      // --- gate 1: the set itself
      const set = await service.getOwned(changeSetId, ownerId);
      if (!set) {
        return { ok: false, error: 'not_found', message: 'That change plan does not exist.' };
      }
      if (set.status !== 'pending') {
        // A repeated approval is a no-op, not a second write (R10).
        return {
          ok: false,
          error: 'not_pending',
          message: `This plan was already ${set.status.replace('_', ' ')} and cannot be applied again.`,
          status: set.status,
        };
      }
      if (set.expiresAt && new Date(set.expiresAt).getTime() <= Date.now()) {
        await service.expire(changeSetId);
        return {
          ok: false,
          error: 'expired',
          message: 'This plan expired before it was approved. Ask for a fresh plan.',
          status: 'expired',
        };
      }

      const allItems: ChangeItem[] = Array.isArray(set.items) ? set.items : [];
      if (!Array.isArray(itemIds) || itemIds.length === 0) {
        return { ok: false, error: 'no_items', message: 'Select at least one item to apply.' };
      }

      // --- gate 2: every requested id exists and is approvable
      const selected: ChangeItem[] = [];
      for (const id of itemIds) {
        const item = allItems.find((i) => i.id === id);
        if (!item) {
          return { ok: false, error: 'unknown_item', message: `This plan has no item "${id}".` };
        }
        if (item.permissionVerdict === 'denied') {
          return {
            ok: false,
            error: 'permission_denied',
            message: `Item "${id}" was blocked when the plan was generated and cannot be approved.`,
          };
        }
        selected.push(item);
      }

      // --- gate 5: destructive confirmation, before anything is written
      const destructive = selected.filter((i) => i.destructive);
      if (destructive.length > 0 && !confirmDestructive) {
        return {
          ok: false,
          error: 'destructive_confirmation_required',
          message: `${destructive.length} of the approved items remove content. Confirm those explicitly before they can be applied.`,
        };
      }

      // --- gate 6: attachment-fed items need a resolved Media Library id
      const missingResolution = selected.filter(
        (i) => typeof i.attachmentOrdinal === 'number' && attachmentResolutions[String(i.attachmentOrdinal)] === undefined
      );
      if (missingResolution.length > 0) {
        return {
          ok: false,
          error: 'attachment_not_resolved',
          message: `Attachment${missingResolution.length > 1 ? 's' : ''} ${missingResolution
            .map((i) => `#${i.attachmentOrdinal}`)
            .join(', ')} must be ingested before this plan can be applied.`,
        };
      }

      const outcomes = new Map<string, ChangeItemOutcome>();

      for (const item of selected) {
        // --- gate 3: LIVE permission re-check. A permission revoked since the plan was shown
        // blocks the item here, writing nothing.
        const action = ACTION_FOR[item.operation];
        if (!can(item.contentTypeUid, action, userAbility)) {
          outcomes.set(item.id, {
            state: 'blocked',
            message: `Your account can no longer ${action} ${item.contentTypeUid}.`,
          });
          continue;
        }

        try {
          if (item.operation === 'create') {
            const data: Record<string, unknown> = {};
            if (item.field) {
              writePath(data, item.field, item.proposedValue);
            } else if (item.proposedValue && typeof item.proposedValue === 'object') {
              Object.assign(data, item.proposedValue as Record<string, unknown>);
            }
            const created = await docs(item.contentTypeUid).create({ data });
            outcomes.set(item.id, {
              state: 'applied',
              oldValue: null,
              newValue: forDisplay(item.proposedValue),
              message: `Created ${item.contentTypeUid} ${created?.documentId ?? ''}`.trim(),
            });
            continue;
          }

          // Re-read the live document for the staleness check and the reported old value.
          const live = isSingle(item.contentTypeUid)
            ? await docs(item.contentTypeUid).findFirst({ populate: '*' })
            : await docs(item.contentTypeUid).findOne({ documentId: item.documentId, populate: '*' });

          if (!live) {
            outcomes.set(item.id, {
              state: 'failed',
              message: `${item.documentLabel} no longer exists.`,
            });
            continue;
          }

          // --- gate 4: per-field staleness. An unrelated edit elsewhere in the document does not
          // block this item; a genuine conflict on THIS field always does.
          if (item.baseFingerprint) {
            const now = fingerprint(live, item.field);
            if (now.fieldHash !== item.baseFingerprint.fieldHash) {
              outcomes.set(item.id, {
                state: 'stale',
                message: `${item.documentLabel} changed since the plan was generated. Nothing was written — ask for a fresh plan.`,
                oldValue: forDisplay(readPath(live, item.field)),
              });
              continue;
            }
          }

          if (item.operation === 'publish') {
            await docs(item.contentTypeUid).publish({ documentId: live.documentId });
            outcomes.set(item.id, {
              state: 'applied',
              message: `Published ${item.documentLabel}.`,
              oldValue: 'draft',
              newValue: 'published',
            });
            continue;
          }

          // update / ingestAttachment: an attachment-fed field writes the ingested media id.
          const value =
            typeof item.attachmentOrdinal === 'number'
              ? attachmentResolutions[String(item.attachmentOrdinal)]
              : item.proposedValue;

          if (item.operation === 'ingestAttachment') {
            // The file is already in the Media Library by this point (gate 6). Nothing to write
            // unless the item also names a field.
            outcomes.set(item.id, {
              state: 'applied',
              message: `Attachment #${item.attachmentOrdinal} is in the Media Library (id ${String(value)}).`,
              oldValue: null,
              newValue: value,
            });
            if (!item.field) {
              continue;
            }
          }

          const oldValue = readPath(live, item.field);
          const data: Record<string, unknown> = {};
          writePath(data, item.field as string, value);
          await docs(item.contentTypeUid).update({ documentId: live.documentId, data });

          outcomes.set(item.id, {
            state: 'applied',
            oldValue: forDisplay(oldValue),
            newValue: forDisplay(value),
            message: `${item.field} on ${item.documentLabel} is now ${
              item.resultingState === 'published' ? 'live' : 'a draft change'
            }.`,
          });
        } catch (err) {
          // Never surface a raw internal error (FR-053).
          outcomes.set(item.id, {
            state: 'failed',
            message: `Could not apply this change to ${item.documentLabel}. The value may not fit the field's rules.`,
          });
          strapi.log.error(
            `[ai-content-studio] apply failed for ${item.contentTypeUid} ${item.id}: ${plugin()
              .service('redact')
              .describeError(err)}`
          );
        }
      }

      const applied = [...outcomes.values()].filter((o) => o.state === 'applied').length;
      const status: ChangeSetStatus = applied === selected.length ? 'applied' : 'partially_applied';
      const appliedAt = new Date().toISOString();

      const mergedItems = allItems.map((i) =>
        outcomes.has(i.id) ? { ...i, outcome: outcomes.get(i.id) as ChangeItemOutcome } : i
      );

      await docs(UID.changeSet).update({
        documentId: changeSetId,
        data: {
          status,
          items: mergedItems,
          resolvedAt: appliedAt,
          approvedByUserId: ownerId,
          approvedItemIds: itemIds,
          destructiveConfirmed: destructive.length > 0 ? true : Boolean(set.destructiveConfirmed),
        },
      });

      // Any transition out of `pending` invalidates the set's previews (FR-012).
      await service.revokePreviews(changeSetId);

      const threadId = set.thread?.documentId ?? null;
      if (threadId) {
        await plugin().service('threads').recordApproval({
          threadId,
          ownerId,
          changeSetId,
          appliedAt,
          items: mergedItems.filter((i) => outcomes.has(i.id)),
        });
      }

      return {
        ok: true,
        status,
        approvedByUserId: ownerId,
        appliedAt,
        items: itemIds.map((id) => ({ id, outcome: outcomes.get(id) as ChangeItemOutcome })),
      };
    },

    /**
     * Reject (T022). Leaves content, media, and configuration untouched — the only effect is the
     * status transition and the revocation of any preview of this set.
     */
    async reject({ changeSetId, ownerId }: { changeSetId: string; ownerId: number }): Promise<{ ok: boolean; error?: string; message?: string }> {
      const set = await service.getOwned(changeSetId, ownerId);
      if (!set) {
        return { ok: false, error: 'not_found', message: 'That change plan does not exist.' };
      }
      if (set.status !== 'pending') {
        return {
          ok: false,
          error: 'not_pending',
          message: `This plan was already ${String(set.status).replace('_', ' ')}.`,
        };
      }
      await docs(UID.changeSet).update({
        documentId: changeSetId,
        data: { status: 'rejected', resolvedAt: new Date().toISOString() },
      });
      await service.revokePreviews(changeSetId);
      const threadId = set.thread?.documentId ?? null;
      if (threadId) {
        await plugin().service('threads').touchLastActivity(threadId, ownerId);
      }
      return { ok: true };
    },

    /** Mark one overdue pending set expired. Writes no content. */
    async expire(changeSetId: string): Promise<void> {
      await docs(UID.changeSet).update({
        documentId: changeSetId,
        data: { status: 'expired', resolvedAt: new Date().toISOString() },
      });
      await service.revokePreviews(changeSetId);
    },

    /**
     * Sweep overdue pending sets (T091). Called opportunistically, so storage does not grow with
     * plans nobody resolved. Content is never touched.
     */
    async expirePending(): Promise<number> {
      const overdue = await docs(UID.changeSet).findMany({
        filters: { status: 'pending', expiresAt: { $lt: new Date().toISOString() } },
        fields: ['documentId'],
        limit: 100,
      });
      const rows = Array.isArray(overdue) ? overdue : [];
      for (const row of rows) {
        await service.expire(row.documentId);
      }
      return rows.length;
    },

    /**
     * Revoke every preview session of a set and drop its staged bytes (FR-012). Called on apply,
     * reject, expiry, and thread deletion — any transition out of `pending`.
     */
    async revokePreviews(changeSetId: string): Promise<void> {
      let preview: any = null;
      try {
        preview = plugin().service('preview');
      } catch {
        // Preview is an optional surface; without it there is nothing to revoke.
        preview = null;
      }
      if (preview?.revokeForChangeSet) {
        await preview.revokeForChangeSet(changeSetId);
      }
    },

    /** Pending sets of a thread — used when a thread is deleted (FR-022). */
    async listByThread(threadId: string): Promise<any[]> {
      const rows = await docs(UID.changeSet).findMany({
        filters: { thread: { documentId: threadId } },
        fields: ['documentId', 'status'],
        limit: -1,
      });
      return Array.isArray(rows) ? rows : [];
    },

    async deleteForThread(threadId: string): Promise<void> {
      for (const row of await service.listByThread(threadId)) {
        await service.revokePreviews(row.documentId);
        await docs(UID.changeSet).delete({ documentId: row.documentId });
      }
    },
  };

  return service;
};

export default changeSetsService;
