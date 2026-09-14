import * as React from 'react';
import { useIntl } from 'react-intl';
import { Button, Typography } from '@strapi/design-system';
import { useAuth } from '@strapi/strapi/admin';
import { styled } from 'styled-components';
import { adminFetch } from '../hooks/useThreads';
import { getTranslation } from '../utils/getTranslation';
import type { ChangeItemView } from '../hooks/useChangeSet';

/**
 * The preview affordance on a pending plan.
 *
 * Opens the real front-end with a signed token so it renders the proposed values (FR-010). When the
 * project has no preview target the server answers 409 with `fallback: 'field-diff'`, and this panel
 * shows the field-by-field comparison INSTEAD — approval is never blocked (FR-014).
 *
 * THE FALLBACK SENTENCE IS RENDERED HERE, NOT SENT (005 contracts/language.md §4). This copy reaches
 * the editor with no model turn in front of it, so the assistant's language rule cannot reach it —
 * an editor working in Ukrainian would read English. The server therefore sends a `reasonCode` and
 * its `reasonParams`, and this panel renders them through the `registerTrads` / react-intl path the
 * plugin already has, in the ADMIN's locale.
 *
 * The server's English `message` is passed as `defaultMessage`, so an unknown or missing code
 * renders EXACTLY what this panel rendered before the codes existed. The degradation is a no-op,
 * never a blank.
 */

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0.9rem 1.2rem;
  border-top: 1px solid ${({ theme }) => theme.colors.neutral150};
`;

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.8rem;
`;

const Note = styled.div`
  font-size: 1.15rem;
  color: ${({ theme }) => theme.colors.neutral600};
`;

const DiffTable = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.3rem;
`;

const DiffRow = styled.div`
  font-size: 1.2rem;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding-bottom: 0.4rem;
  border-bottom: 1px solid ${({ theme }) => theme.colors.neutral150};
  &:last-child {
    border-bottom: none;
  }
`;

const Field = styled.span`
  color: ${({ theme }) => theme.colors.neutral800};
  font-weight: 600;
`;

const Old = styled.span`
  color: ${({ theme }) => theme.colors.neutral600};
  text-decoration: line-through;
  word-break: break-word;
`;

const New = styled.span`
  color: ${({ theme }) => theme.colors.success600};
  word-break: break-word;
`;

interface PreviewResponse {
  sessionId: string;
  token: string;
  previewUrl: string;
  expiresAt: string;
  stagedFiles: Array<{ ordinal: number; fileId: string }>;
}

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

export interface PreviewPanelProps {
  changeSetId: string;
  items: ChangeItemView[];
  /** Disabled once the plan is resolved — there is nothing pending left to preview. */
  disabled?: boolean;
  /** Held files for the ordinals this plan places, so proposed media renders (FR-013). */
  filesByOrdinal?: Record<number, File>;
}

export const PreviewPanel = ({ changeSetId, items, disabled = false, filesByOrdinal }: PreviewPanelProps) => {
  const { formatMessage } = useIntl();
  const token = useAuth('AiContentStudioPreview', (state) => state.token);
  const tokenRef = React.useRef<string | null>(token);
  React.useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  const [busy, setBusy] = React.useState(false);
  const [session, setSession] = React.useState<PreviewResponse | null>(null);
  const [fallback, setFallback] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const previewable = items.filter(
    (i) => i.field && i.documentId && i.permissionVerdict === 'allowed' && i.operation !== 'publish'
  );

  const openPreview = async () => {
    setBusy(true);
    setError(null);
    setFallback(null);
    try {
      // Multipart: held bytes ride along so a proposed image renders without entering the library.
      const form = new FormData();
      const target = previewable[0];
      if (target?.contentTypeUid) {
        form.append('targetContentTypeUid', target.contentTypeUid);
      }
      if (target?.documentId) {
        form.append('targetDocumentId', target.documentId);
      }
      for (const item of previewable) {
        const ordinal = item.attachmentOrdinal;
        const file = ordinal !== null && filesByOrdinal ? filesByOrdinal[ordinal] : undefined;
        if (ordinal !== null && file) {
          form.append(`attachment[${ordinal}]`, file, file.name);
        }
      }

      const result = await adminFetch<PreviewResponse>(
        `/change-sets/${changeSetId}/preview`,
        tokenRef.current,
        { method: 'POST', body: form }
      );
      setSession(result);
      window.open(result.previewUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      const payload = (
        err as Error & {
          payload?: {
            fallback?: string;
            message?: string;
            reasonCode?: string;
            reasonParams?: Record<string, string>;
          };
        }
      ).payload;
      if (payload?.fallback === 'field-diff') {
        // Contracted degradation, not an error — show the comparison and keep approval available.
        const serverSentence = payload.message ?? 'Preview is unavailable for this project.';
        setFallback(
          payload.reasonCode
            ? formatMessage(
                { id: getTranslation(payload.reasonCode), defaultMessage: serverSentence },
                payload.reasonParams ?? {}
              )
            : serverSentence
        );
      } else {
        setError(err instanceof Error ? err.message : 'Could not open the preview.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Wrap>
      <Row>
        <Button
          variant="secondary"
          onClick={() => void openPreview()}
          disabled={disabled || busy || previewable.length === 0}
          loading={busy}
        >
          Preview on the site
        </Button>
        {session ? (
          <Note>
            Preview open — it expires at {new Date(session.expiresAt).toLocaleTimeString()} and stops
            working as soon as this plan is approved or rejected.
          </Note>
        ) : null}
        {error ? <Note>{error}</Note> : null}
      </Row>

      {fallback ? (
        <>
          <Note>{fallback}</Note>
          <Typography variant="pi" fontWeight="bold">
            Before / after
          </Typography>
          <DiffTable>
            {previewable.map((item) => (
              <DiffRow key={item.id}>
                <Field>
                  {item.field} — {item.documentLabel}
                </Field>
                <Old>{show(item.currentValue)}</Old>
                <New>
                  {item.attachmentOrdinal !== null
                    ? `attachment #${item.attachmentOrdinal}`
                    : show(item.proposedValue)}
                </New>
              </DiffRow>
            ))}
          </DiffTable>
        </>
      ) : null}
    </Wrap>
  );
};

export default PreviewPanel;
