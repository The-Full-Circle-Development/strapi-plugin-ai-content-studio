import * as React from 'react';
import { useAuth } from '@strapi/strapi/admin';
import { adminFetch } from './useThreads';

/** Fetch, select, approve and reject a pending change plan. */

export type ChangeSetStatus = 'pending' | 'applied' | 'partially_applied' | 'rejected' | 'expired';

export interface ChangeItemView {
  id: string;
  operation: 'create' | 'update' | 'publish' | 'ingestAttachment';
  contentTypeUid: string;
  documentId: string | null;
  documentLabel: string;
  field: string | null;
  currentValue: unknown;
  proposedValue: unknown;
  resultingState: 'draft' | 'published' | 'unchanged';
  destructive: boolean;
  attachmentOrdinal: number | null;
  permissionVerdict: 'allowed' | 'denied';
  permissionReason?: string;
  outcome: {
    /** The WRITE phase's result. */
    state: 'applied' | 'blocked' | 'stale' | 'failed' | 'skipped';
    message?: string;
    oldValue?: unknown;
    newValue?: unknown;
    /** Present only when the approve-and-publish action ran (FR-050). */
    publish?: {
      state: 'published' | 'blocked' | 'failed' | 'not_applicable' | 'skipped';
      message?: string;
    } | null;
  } | null;
}

export interface ChangeSetView {
  id: string;
  threadId: string | null;
  status: ChangeSetStatus;
  summary: string | null;
  proposedAt: string;
  expiresAt: string;
  resolvedAt: string | null;
  hasDestructive: boolean;
  destructiveConfirmed: boolean;
  items: ChangeItemView[];
}

export interface ApplyReportItem {
  id: string;
  outcome: ChangeItemView['outcome'];
}

export interface ApplyResult {
  status: ChangeSetStatus;
  approvedByUserId: number;
  appliedAt: string;
  items: ApplyReportItem[];
}

export function useChangeSet(changeSetId: string | null) {
  const token = useAuth('AiContentStudioChangeSet', (state) => state.token);
  const tokenRef = React.useRef<string | null>(token);
  React.useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  const [changeSet, setChangeSet] = React.useState<ChangeSetView | null>(null);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async (id: string) => {
    setError(null);
    try {
      const set = await adminFetch<ChangeSetView>(`/change-sets/${id}`, tokenRef.current);
      setChangeSet(set);
      // Pre-select everything the caller may actually perform; blocked items can never be approved.
      setSelected(set.items.filter((i) => i.permissionVerdict === 'allowed').map((i) => i.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the change plan.');
    }
  }, []);

  React.useEffect(() => {
    if (changeSetId) {
      void load(changeSetId);
    } else {
      setChangeSet(null);
      setSelected([]);
    }
  }, [changeSetId, load]);

  const toggleItem = React.useCallback(
    (itemId: string) => {
      const item = changeSet?.items.find((i) => i.id === itemId);
      if (!item || item.permissionVerdict === 'denied') {
        return;
      }
      setSelected((current) =>
        current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId]
      );
    },
    [changeSet]
  );

  const selectedItems = React.useMemo(
    () => (changeSet?.items ?? []).filter((i) => selected.includes(i.id)),
    [changeSet, selected]
  );

  /** True when the current selection contains something that removes content (FR-007). */
  const selectionHasDestructive = selectedItems.some((i) => i.destructive);

  /** Ordinals in the selection that must reach the Media Library before apply can run. */
  const selectedOrdinals = React.useMemo(
    () =>
      selectedItems
        .map((i) => i.attachmentOrdinal)
        .filter((ordinal): ordinal is number => typeof ordinal === 'number'),
    [selectedItems]
  );

  const apply = React.useCallback(
    async ({
      itemIds,
      confirmDestructive = false,
      attachmentResolutions = {},
      publish = false,
      confirmPublish = false,
    }: {
      itemIds: string[];
      confirmDestructive?: boolean;
      attachmentResolutions?: Record<string, number>;
      /** Set only by the Approve & Publish action (FR-044). */
      publish?: boolean;
      /** Must accompany `publish`; the server refuses the pair otherwise with a 409 (FR-045). */
      confirmPublish?: boolean;
    }): Promise<ApplyResult | null> => {
      if (!changeSet) {
        return null;
      }
      setBusy(true);
      setError(null);
      try {
        const result = await adminFetch<ApplyResult>(`/change-sets/${changeSet.id}/apply`, tokenRef.current, {
          method: 'POST',
          body: JSON.stringify({
            itemIds,
            confirmDestructive,
            attachmentResolutions,
            publish,
            confirmPublish,
          }),
        });
        await load(changeSet.id);
        return result;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not apply the change plan.');
        return null;
      } finally {
        setBusy(false);
      }
    },
    [changeSet, load]
  );

  const reject = React.useCallback(async (): Promise<boolean> => {
    if (!changeSet) {
      return false;
    }
    setBusy(true);
    setError(null);
    try {
      await adminFetch<void>(`/change-sets/${changeSet.id}/reject`, tokenRef.current, { method: 'POST' });
      await load(changeSet.id);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reject the change plan.');
      return false;
    } finally {
      setBusy(false);
    }
  }, [changeSet, load]);

  return {
    changeSet,
    selected,
    selectedItems,
    selectionHasDestructive,
    selectedOrdinals,
    toggleItem,
    setSelected,
    apply,
    reject,
    reload: load,
    busy,
    error,
  };
}

export default useChangeSet;
