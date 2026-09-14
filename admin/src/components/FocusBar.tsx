import * as React from 'react';
import { useIntl } from 'react-intl';
import { Button, IconButton } from '@strapi/design-system';
import { Cross, Pin } from '@strapi/icons';
import { styled } from 'styled-components';
import { getTranslation } from '../utils/getTranslation';
import { FocusPicker } from './FocusPicker';
import type { FocusCandidate, FocusOptions, FocusValue } from '../hooks/useFocus';

/**
 * Show, set, change and clear the conversation's Focus (005 FR-015).
 *
 * ⚠ IT IS VISIBLE AT ALL TIMES, and that is the requirement rather than a layout preference. Focus
 * silently changes which entry "this page" means; an editor who cannot see what is focused cannot
 * tell whether an answer is about what they think it is about. A hidden Focus would be worse than
 * none, because it would be a wrong assumption they had no way to check.
 *
 * It shows a LABEL, not a claim. The server re-resolves the focus and re-checks permissions on every
 * turn — a label here that has gone stale cannot become a statement.
 */

const Bar = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.6rem;
  padding: 0.4rem 0;
`;

const Chip = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  max-width: 100%;
  font-size: 1.2rem;
  color: ${({ theme }) => theme.colors.neutral700};
  background: ${({ theme }) => theme.colors.neutral100};
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: 1.6rem;
  padding: 0.2rem 0.4rem 0.2rem 0.8rem;
`;

const ChipLabel = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 28rem;
`;

const Muted = styled.span`
  font-size: 1.2rem;
  color: ${({ theme }) => theme.colors.neutral600};
`;

const PickerAnchor = styled.div`
  position: relative;
`;

const PickerFloat = styled.div`
  position: absolute;
  bottom: calc(100% + 0.6rem);
  left: 0;
  z-index: 10;
`;

export interface FocusBarProps {
  focus: FocusValue | null;
  options: FocusOptions | null;
  busy: boolean;
  error: string | null;
  /** Loaded lazily, the first time the editor opens the picker. */
  onLoadOptions: () => void;
  searchEntries: (uid: string, q: string, locale: string | null) => Promise<FocusCandidate[]>;
  onSet: (input: { uid: string; documentId?: string | null; locale?: string | null }) => void;
  onClear: () => void;
  disabled?: boolean;
}

export const FocusBar = ({
  focus,
  options,
  busy,
  error,
  onLoadOptions,
  searchEntries,
  onSet,
  onClear,
  disabled = false,
}: FocusBarProps) => {
  const { formatMessage } = useIntl();
  const [open, setOpen] = React.useState(false);

  const openPicker = () => {
    if (!options) {
      onLoadOptions();
    }
    setOpen(true);
  };

  return (
    <Bar>
      <PickerAnchor>
        {focus ? (
          <Chip>
            <Pin aria-hidden />
            <ChipLabel title={`${focus.label} — ${focus.uid}`}>
              {focus.label}
              {/* Shown only when the focus actually recorded one, so a single-locale install
                  displays nothing about language versions (FR-042, SC-018). */}
              {focus.locale ? ` (${focus.locale})` : ''}
            </ChipLabel>
            <IconButton
              variant="ghost"
              label={formatMessage({
                id: getTranslation('focus.clear'),
                defaultMessage: 'Clear focus',
              })}
              onClick={onClear}
              disabled={disabled || busy}
            >
              <Cross />
            </IconButton>
          </Chip>
        ) : (
          <Muted>
            {formatMessage({
              id: getTranslation('focus.none'),
              defaultMessage: 'No focus set — the assistant will ask which entry you mean.',
            })}
          </Muted>
        )}

        {open && options ? (
          <PickerFloat>
            <FocusPicker
              options={options}
              busy={busy}
              error={error}
              searchEntries={searchEntries}
              onSet={(input) => {
                onSet(input);
                setOpen(false);
              }}
              onCancel={() => setOpen(false)}
            />
          </PickerFloat>
        ) : null}
      </PickerAnchor>

      <Button variant="tertiary" onClick={openPicker} disabled={disabled || busy}>
        {focus
          ? formatMessage({ id: getTranslation('focus.change'), defaultMessage: 'Change focus' })
          : formatMessage({ id: getTranslation('focus.setShort'), defaultMessage: 'Set focus' })}
      </Button>
    </Bar>
  );
};

export default FocusBar;
