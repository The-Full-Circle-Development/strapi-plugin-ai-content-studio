import * as React from 'react';
import { Button, Checkbox, Typography } from '@strapi/design-system';
import { styled } from 'styled-components';
import { useChangeSet, type ChangeItemView } from '../hooks/useChangeSet';
import { PreviewPanel } from './PreviewPanel';
import { RiskyActions, RiskyConfirm, RiskyDetail, RiskyHeading } from './styles';

/**
 * The change plan, rendered per item so approval is a deliberate act (FR-002, FR-003).
 *
 * Every row shows target type, document label, field, current -> proposed value, the resulting
 * draft/published state, and — for a blocked item — the permission reason. Destructive items are
 * visually distinguished and need a SEPARATE explicit confirmation before they can apply (FR-007).
 */

const Card = styled.div`
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: 0.8rem;
  background: ${({ theme }) => theme.colors.neutral0};
  overflow: hidden;
  align-self: stretch;
`;

const Head = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.2rem;
  border-bottom: 1px solid ${({ theme }) => theme.colors.neutral150};
  background: ${({ theme }) => theme.colors.neutral100};
`;

const StatusChip = styled.span<{ $tone: 'neutral' | 'success' | 'danger' | 'warning' }>`
  font-size: 1.1rem;
  padding: 0.2rem 0.7rem;
  border-radius: 1rem;
  white-space: nowrap;
  color: ${({ theme, $tone }) =>
    $tone === 'success'
      ? theme.colors.success600
      : $tone === 'danger'
        ? theme.colors.danger600
        : $tone === 'warning'
          ? theme.colors.warning600
          : theme.colors.neutral600};
  background: ${({ theme, $tone }) =>
    $tone === 'success'
      ? theme.colors.success100
      : $tone === 'danger'
        ? theme.colors.danger100
        : $tone === 'warning'
          ? theme.colors.warning100
          : theme.colors.neutral150};
`;

const Row = styled.div<{ $destructive?: boolean; $blocked?: boolean }>`
  display: flex;
  gap: 0.8rem;
  padding: 0.9rem 1.2rem;
  border-bottom: 1px solid ${({ theme }) => theme.colors.neutral150};
  opacity: ${({ $blocked }) => ($blocked ? 0.65 : 1)};
  border-left: 3px solid
    ${({ theme, $destructive }) => ($destructive ? theme.colors.danger500 : 'transparent')};
  &:last-of-type {
    border-bottom: none;
  }
`;

const RowBody = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
`;

const Target = styled.div`
  font-size: 1.3rem;
  color: ${({ theme }) => theme.colors.neutral800};
  font-weight: 600;
  word-break: break-word;
`;

const Meta = styled.div`
  font-size: 1.1rem;
  color: ${({ theme }) => theme.colors.neutral600};
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
`;

const Diff = styled.div`
  font-size: 1.2rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  margin-top: 0.2rem;
`;

const Old = styled.div`
  color: ${({ theme }) => theme.colors.neutral600};
  text-decoration: line-through;
  word-break: break-word;
`;

const New = styled.div`
  color: ${({ theme }) => theme.colors.success600};
  word-break: break-word;
`;

const Reason = styled.div`
  font-size: 1.15rem;
  color: ${({ theme }) => theme.colors.danger600};
`;

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.8rem;
  padding: 1rem 1.2rem;
  border-top: 1px solid ${({ theme }) => theme.colors.neutral150};
`;

const Confirm = styled.div`
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.8rem 1.2rem;
  background: ${({ theme }) => theme.colors.danger100};
  border-top: 1px solid ${({ theme }) => theme.colors.danger200};
  color: ${({ theme }) => theme.colors.danger700};
  font-size: 1.2rem;
`;

const Note = styled.div`
  font-size: 1.15rem;
  color: ${({ theme }) => theme.colors.neutral600};
  padding: 0.8rem 1.2rem 0;
`;

const show = (value: unknown): string => {
  if (value === null || value === undefined || value === '') {
    return '(empty)';
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const OUTCOME_TONE: Record<string, 'success' | 'danger' | 'warning' | 'neutral'> = {
  applied: 'success',
  blocked: 'danger',
  failed: 'danger',
  stale: 'warning',
  skipped: 'neutral',
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'Awaiting your approval',
  applied: 'Applied',
  partially_applied: 'Partially applied',
  rejected: 'Rejected',
  expired: 'Expired',
};

/** The report row shape the transcript renders. Built here, where both halves are in hand. */
export interface ApplyReportRow {
  id: string;
  field: string | null;
  documentLabel: string;
  resultingState: string;
  state: string;
  message: string | null;
  oldValue: unknown;
  newValue: unknown;
  /** Present only when the approve-and-publish action ran (FR-050). */
  publish?: { state: string; message?: string | null } | null;
}

export interface ApplyReport {
  changeSetId: string;
  appliedAt: string;
  items: ApplyReportRow[];
}

export interface ChangePlanCardProps {
  changeSetId: string;
  /** Called with the finished report so the page can append it to the conversation (FR-006/008). */
  onApplied?: (report: ApplyReport) => void;
  onRejected?: (changeSetId: string) => void;
  /** Resolves the ordinals an approved plan needs into Media Library ids (US6). */
  resolveAttachments?: (ordinals: number[]) => Promise<Record<string, number>>;
  /** Held files by ordinal, so a preview can stage proposed media (US2 + US6). */
  filesByOrdinal?: Record<number, File>;
  /** Rendered under the actions, in place of the built-in preview panel. */
  footer?: React.ReactNode;
}

export const ChangePlanCard = ({
  changeSetId,
  onApplied,
  onRejected,
  resolveAttachments,
  filesByOrdinal,
  footer,
}: ChangePlanCardProps) => {
  const {
    changeSet,
    selected,
    selectedItems,
    selectionHasDestructive,
    toggleItem,
    setSelected,
    apply,
    reject,
    busy,
    error,
  } = useChangeSet(changeSetId);

  const [confirmDestructive, setConfirmDestructive] = React.useState(false);
  const [localError, setLocalError] = React.useState<string | null>(null);
  /**
   * The item ids awaiting publish confirmation, or null when the risky action is not armed.
   *
   * Holding the INTENT rather than acting on the click is what makes FR-045 true: a single
   * activation writes nothing and publishes nothing, and dismissing this or navigating away leaves
   * both undone.
   */
  const [publishIntent, setPublishIntent] = React.useState<string[] | null>(null);

  // Unticking the destructive items must also drop the confirmation — it is never sticky.
  React.useEffect(() => {
    if (!selectionHasDestructive) {
      setConfirmDestructive(false);
    }
  }, [selectionHasDestructive]);

  // An armed publish confirmation must never outlive the selection it was armed for.
  React.useEffect(() => {
    setPublishIntent(null);
  }, [selected]);

  if (!changeSet) {
    return error ? <Note>{error}</Note> : null;
  }

  const resolved = changeSet.status !== 'pending';
  const allowedIds = changeSet.items.filter((i) => i.permissionVerdict === 'allowed').map((i) => i.id);
  const expired = new Date(changeSet.expiresAt).getTime() <= Date.now();

  /**
   * How many DOCUMENTS the confirmation is about (FR-045).
   *
   * Counted the same way the server picks its publish targets: distinct
   * `(contentTypeUid, documentId)` pairs, excluding items whose operation is already `publish`.
   * Two field changes on one document are one publish, so they must read as one document here —
   * counting items instead would overstate the consequence.
   */
  const documentsToPublish = new Set(
    (publishIntent ?? [])
      .map((id) => changeSet.items.find((i) => i.id === id))
      .filter(
        (i): i is ChangeItemView => Boolean(i) && i!.operation !== 'publish' && Boolean(i!.documentId)
      )
      .map((i) => `${i.contentTypeUid}::${i.documentId}`)
  ).size;

  const runApply = async (itemIds: string[], withPublish = false) => {
    setLocalError(null);
    if (itemIds.length === 0) {
      return;
    }
    let attachmentResolutions: Record<string, number> = {};
    const ordinals = changeSet.items
      .filter((i) => itemIds.includes(i.id))
      .map((i) => i.attachmentOrdinal)
      .filter((o): o is number => typeof o === 'number');

    if (ordinals.length > 0) {
      if (!resolveAttachments) {
        setLocalError('These files must be ingested first, and this panel cannot do that here.');
        return;
      }
      try {
        // Ingestion happens FIRST and only now — this is the moment of ingestion (FR-033).
        attachmentResolutions = await resolveAttachments(ordinals);
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : 'Could not add the files to the Media Library.');
        return;
      }
    }

    const report = await apply({
      itemIds,
      confirmDestructive,
      attachmentResolutions,
      // The confirmation is the ONLY path that sets these, and it sets both together — the server
      // refuses `publish` without `confirmPublish` before writing anything (FR-045).
      publish: withPublish,
      confirmPublish: withPublish,
    });
    if (report) {
      const byId = new Map(changeSet.items.map((i) => [i.id, i]));
      onApplied?.({
        changeSetId: changeSet.id,
        appliedAt: report.appliedAt,
        items: report.items.map(({ id, outcome }) => {
          const item = byId.get(id);
          return {
            id,
            field: item?.field ?? null,
            documentLabel: item?.documentLabel ?? 'the target',
            resultingState: item?.resultingState ?? 'unchanged',
            state: outcome?.state ?? 'skipped',
            message: outcome?.message ?? null,
            oldValue: outcome?.oldValue ?? null,
            newValue: outcome?.newValue ?? null,
            publish: outcome?.publish ?? null,
          };
        }),
      });
    }
  };

  return (
    <Card>
      <Head>
        <Typography variant="delta">{changeSet.summary ?? 'Proposed changes'}</Typography>
        <StatusChip
          $tone={
            changeSet.status === 'applied'
              ? 'success'
              : changeSet.status === 'partially_applied'
                ? 'warning'
                : changeSet.status === 'pending'
                  ? 'neutral'
                  : 'danger'
          }
        >
          {STATUS_LABEL[changeSet.status] ?? changeSet.status}
        </StatusChip>
      </Head>

      {changeSet.status === 'pending' ? (
        <Note>
          Nothing has been written yet.{' '}
          {expired
            ? 'This plan has expired — ask for a fresh one.'
            : `This plan expires at ${new Date(changeSet.expiresAt).toLocaleTimeString()}.`}
        </Note>
      ) : null}

      {changeSet.items.map((item) => {
        const blocked = item.permissionVerdict === 'denied';
        return (
          <Row key={item.id} $destructive={item.destructive} $blocked={blocked}>
            {!resolved ? (
              <Checkbox
                checked={selected.includes(item.id)}
                disabled={blocked || busy || expired}
                onCheckedChange={() => toggleItem(item.id)}
                aria-label={`Approve ${item.field ?? item.operation} on ${item.documentLabel}`}
              />
            ) : null}
            <RowBody>
              <Target>
                {item.operation === 'publish'
                  ? `Publish ${item.documentLabel}`
                  : `${item.field ?? item.operation} — ${item.documentLabel}`}
              </Target>
              <Meta>
                <span>{item.contentTypeUid}</span>
                <span>
                  result:{' '}
                  {item.resultingState === 'unchanged' ? 'no content change' : item.resultingState}
                </span>
                {item.destructive ? <StatusChip $tone="danger">removes content</StatusChip> : null}
                {item.attachmentOrdinal !== null ? <span>attachment #{item.attachmentOrdinal}</span> : null}
              </Meta>

              {item.operation !== 'publish' ? (
                <Diff>
                  <Old>{show(item.currentValue)}</Old>
                  <New>
                    {item.attachmentOrdinal !== null
                      ? `attachment #${item.attachmentOrdinal}`
                      : show(item.proposedValue)}
                  </New>
                </Diff>
              ) : null}

              {blocked ? <Reason>{item.permissionReason ?? 'You cannot perform this change.'}</Reason> : null}

              {item.outcome ? (
                <Meta>
                  <StatusChip $tone={OUTCOME_TONE[item.outcome.state] ?? 'neutral'}>
                    {item.outcome.state}
                  </StatusChip>
                  {item.outcome.message ? <span>{item.outcome.message}</span> : null}
                </Meta>
              ) : null}
            </RowBody>
          </Row>
        );
      })}

      {!resolved && selectionHasDestructive ? (
        <Confirm>
          <Checkbox
            checked={confirmDestructive}
            onCheckedChange={() => setConfirmDestructive((v) => !v)}
            aria-label="Confirm the changes that remove content"
          />
          <span>
            {selectedItems.filter((i) => i.destructive).length} selected change
            {selectedItems.filter((i) => i.destructive).length === 1 ? '' : 's'} will remove content.
            Confirm explicitly to include them.
          </span>
        </Confirm>
      ) : null}

      {/*
        The Approve & Publish confirmation. It states BOTH consequences, because the second one —
        that publication is document-scoped — is the one consequence of this action that is
        invisible in the plan's own before/after rows above (FR-045).
      */}
      {!resolved && publishIntent ? (
        <RiskyConfirm>
          <RiskyHeading>Publish {documentsToPublish} document{documentsToPublish === 1 ? '' : 's'}?</RiskyHeading>
          <RiskyDetail>Publishing makes this content publicly visible immediately.</RiskyDetail>
          <RiskyDetail>
            It publishes each affected document&rsquo;s <strong>entire current draft</strong> — not
            only the fields this plan reviewed. Any unreviewed draft edit already sitting on those
            documents will go live with it.
          </RiskyDetail>
          <RiskyActions>
            <Button
              variant="danger"
              onClick={() => {
                const ids = publishIntent;
                setPublishIntent(null);
                void runApply(ids, true);
              }}
              disabled={busy}
              loading={busy}
            >
              Yes, apply and publish
            </Button>
            <Button variant="tertiary" onClick={() => setPublishIntent(null)} disabled={busy}>
              Cancel
            </Button>
          </RiskyActions>
        </RiskyConfirm>
      ) : null}

      {!resolved ? (
        <Actions>
          <Button
            onClick={() => void runApply(allowedIds)}
            disabled={busy || expired || allowedIds.length === 0}
            loading={busy}
          >
            Approve all
          </Button>
          <Button
            variant="secondary"
            onClick={() => void runApply(selected)}
            disabled={busy || expired || selected.length === 0 || selected.length === allowedIds.length}
          >
            Approve selected ({selected.length})
          </Button>
          {/*
            Visually distinct and labelled to signal its risk — a danger variant, never styled as
            the safe default (FR-044). Activating it only ARMS the confirmation above; it applies
            and publishes nothing on its own (FR-045). Disabled under exactly the same conditions as
            the existing actions.
          */}
          <Button
            variant="danger"
            onClick={() => setPublishIntent(selected.length > 0 ? selected : allowedIds)}
            disabled={busy || expired || allowedIds.length === 0 || publishIntent !== null}
          >
            Approve &amp; Publish (Risky)
          </Button>
          <Button
            variant="tertiary"
            onClick={() => {
              void reject().then((ok) => {
                if (ok) {
                  onRejected?.(changeSet.id);
                }
              });
            }}
            disabled={busy}
          >
            Reject
          </Button>
          {selected.length !== allowedIds.length ? (
            <Button variant="ghost" onClick={() => setSelected(allowedIds)} disabled={busy}>
              Select all
            </Button>
          ) : null}
        </Actions>
      ) : null}

      {footer ?? (
        <PreviewPanel
          changeSetId={changeSet.id}
          items={changeSet.items}
          disabled={resolved || expired}
          filesByOrdinal={filesByOrdinal}
        />
      )}
      {localError ?? error ? <Note>{localError ?? error}</Note> : null}
    </Card>
  );
};

export default ChangePlanCard;
