import * as React from 'react';
import { useIntl } from 'react-intl';
import {
  Button,
  Combobox,
  ComboboxOption,
  SingleSelect,
  SingleSelectOption,
  Typography,
} from '@strapi/design-system';
import { styled } from 'styled-components';
import { getTranslation } from '../utils/getTranslation';
import type { FocusCandidate, FocusOptions } from '../hooks/useFocus';

/**
 * Choose what the assistant should treat as "this page": content type, then entry, then — only
 * where there is a choice to make — language version (005 contracts/situation-and-focus.md §1).
 *
 * ⚠ THE LANGUAGE CONTROL IS ABSENT, NOT DISABLED, ON A SINGLE-LOCALE INSTALL (FR-042, SC-018). That
 * is the same structural rule the tool schemas follow: an install with one locale must be
 * indistinguishable from a build without the capability. A greyed-out control would still be
 * something to notice and wonder about.
 *
 * `@strapi/design-system` v2 and `@strapi/icons` v2 only — no new UI framework, no CSS toolkit.
 */

const Panel = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  padding: 1rem;
  min-width: 32rem;
  background: ${({ theme }) => theme.colors.neutral0};
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: 0.4rem;
`;

const Row = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
`;

const Actions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
`;

const ErrorNote = styled.div`
  font-size: 1.2rem;
  color: ${({ theme }) => theme.colors.danger600};
`;

export interface FocusPickerProps {
  options: FocusOptions;
  busy: boolean;
  error: string | null;
  searchEntries: (uid: string, q: string, locale: string | null) => Promise<FocusCandidate[]>;
  onSet: (input: { uid: string; documentId?: string | null; locale?: string | null }) => void;
  onCancel: () => void;
}

export const FocusPicker = ({
  options,
  busy,
  error,
  searchEntries,
  onSet,
  onCancel,
}: FocusPickerProps) => {
  const { formatMessage } = useIntl();
  const [uid, setUid] = React.useState<string | null>(null);
  const [locale, setLocale] = React.useState<string | null>(options.defaultLocale);
  const [query, setQuery] = React.useState('');
  const [candidates, setCandidates] = React.useState<FocusCandidate[]>([]);
  const [documentId, setDocumentId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const selected = options.contentTypes.find((ct) => ct.uid === uid) ?? null;
  const isSingle = selected?.kind === 'singleType';

  /**
   * The language control appears only when BOTH the install has more than one locale AND the chosen
   * content type actually holds language versions. Either alone would offer a choice that does not
   * exist.
   */
  const showLocale = options.multiLocale && Boolean(selected?.localized);

  /**
   * Search whenever the content type, the query or the language version changes — debounced,
   * because this is a keystroke-driven request against the caller's own permissions.
   *
   * A single type has exactly one document, so it is fetched once with no query: asking an editor
   * to search a list of one is a step that buys nothing.
   */
  React.useEffect(() => {
    if (!uid) {
      setCandidates([]);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void searchEntries(uid, isSingle ? '' : query, showLocale ? locale : null).then((entries) => {
        if (cancelled) {
          return;
        }
        setCandidates(entries);
        setLoading(false);
      });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [uid, query, locale, isSingle, showLocale, searchEntries]);

  const canSubmit = Boolean(uid) && (isSingle || Boolean(documentId));

  return (
    <Panel>
      <Row>
        <Typography variant="pi" fontWeight="bold">
          {formatMessage({ id: getTranslation('focus.contentType'), defaultMessage: 'Content type' })}
        </Typography>
        <SingleSelect
          value={uid ?? ''}
          onChange={(value) => {
            setUid(String(value));
            // Everything downstream belongs to the previous content type.
            setDocumentId(null);
            setQuery('');
            setCandidates([]);
          }}
          placeholder={formatMessage({
            id: getTranslation('focus.contentTypePlaceholder'),
            defaultMessage: 'Choose a content type',
          })}
        >
          {options.contentTypes.map((ct) => (
            <SingleSelectOption key={ct.uid} value={ct.uid}>
              {ct.displayName}
            </SingleSelectOption>
          ))}
        </SingleSelect>
      </Row>

      {showLocale ? (
        <Row>
          <Typography variant="pi" fontWeight="bold">
            {formatMessage({
              id: getTranslation('focus.locale'),
              defaultMessage: 'Language version',
            })}
          </Typography>
          <SingleSelect
            value={locale ?? ''}
            onChange={(value) => {
              setLocale(String(value));
              // A documentId is per language version — keeping it across a switch would point at
              // an entry the editor did not choose.
              setDocumentId(null);
            }}
          >
            {options.locales.map((code) => (
              <SingleSelectOption key={code} value={code}>
                {code}
              </SingleSelectOption>
            ))}
          </SingleSelect>
        </Row>
      ) : null}

      {uid && !isSingle ? (
        <Row>
          <Typography variant="pi" fontWeight="bold">
            {formatMessage({ id: getTranslation('focus.entry'), defaultMessage: 'Entry' })}
          </Typography>
          <Combobox
            value={documentId ?? ''}
            onChange={(value) => setDocumentId(value ? String(value) : null)}
            onFilterValueChange={(value: string) => setQuery(value ?? '')}
            loading={loading}
            placeholder={formatMessage({
              id: getTranslation('focus.entryPlaceholder'),
              defaultMessage: 'Search for an entry',
            })}
            noOptionsMessage={() =>
              formatMessage({
                id: getTranslation('focus.noEntries'),
                defaultMessage: 'No entries matched.',
              })
            }
          >
            {candidates.map((candidate) => (
              <ComboboxOption key={candidate.documentId ?? 'single'} value={candidate.documentId ?? ''}>
                {candidate.label}
              </ComboboxOption>
            ))}
          </Combobox>
        </Row>
      ) : null}

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <Actions>
        <Button variant="tertiary" onClick={onCancel} disabled={busy}>
          {formatMessage({ id: getTranslation('focus.cancel'), defaultMessage: 'Cancel' })}
        </Button>
        <Button
          onClick={() =>
            onSet({
              uid: uid as string,
              documentId: isSingle ? null : documentId,
              locale: showLocale ? locale : null,
            })
          }
          disabled={!canSubmit || busy}
          loading={busy}
        >
          {formatMessage({ id: getTranslation('focus.set'), defaultMessage: 'Set focus' })}
        </Button>
      </Actions>
    </Panel>
  );
};

export default FocusPicker;
