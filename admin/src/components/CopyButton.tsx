import * as React from 'react';
import { IconButton } from '@strapi/design-system';
import { Duplicate } from '@strapi/icons';
import { useCopy } from '../hooks/useCopy';

/**
 * A copy control (FR-038..FR-043).
 *
 * BUILT FROM THE DESIGN SYSTEM'S `IconButton`, not a hand-written `<button>`. That is what supplies
 * FR-041 for free: `IconButton` requires a `label`, renders a real `<button type="button">`, wraps
 * the icon in `AccessibleIcon` (an `aria-hidden` svg plus a visually-hidden text label) and adds a
 * tooltip by default. So it is focusable, has an accessible name, and is operable without a
 * pointer — none of which has to be re-created here. The repo already ships this exact shape at
 * ThreadSidebar.tsx:196.
 *
 * TWO DELIBERATE CHOICES, both noted because they are easy to get wrong:
 *
 *  1. There is a COMPETING local `styled.button` also named `IconButton` in `./styles` (used by
 *     `Composer.tsx`). This imports the design-system one on purpose, not by import order.
 *  2. `IconButton`'s accessible name comes from a visually-hidden text node rather than an
 *     `aria-label` ATTRIBUTE. `aria-label` is passed explicitly as well — props spread through — so
 *     the name is assertable either way.
 *
 * The outcome is ANNOUNCED, not merely coloured. The notifier is passed in from `MessageList`
 * rather than obtained here: `useNotifyAT`'s cleanup clears all three live regions when ANY
 * consumer unmounts, so calling it inside a per-message control would let one unmounting control
 * wipe another's pending announcement.
 */

export interface CopyButtonProps {
  /** The exact text to place on the clipboard. */
  value: string;
  /** English accessible name, e.g. "Copy this reply" / "Copy this code block". */
  label: string;
  /** Announces the outcome into a live region owned by an ancestor. */
  announce: (message: string, ok: boolean) => void;
}

export const CopyButton = ({ value, label, announce }: CopyButtonProps) => {
  const { copy } = useCopy();
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<number | null>(null);

  React.useEffect(
    () => () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
      }
    },
    []
  );

  const onClick = async () => {
    const result = await copy(value);
    // Brief and visible on success; an EXPLICIT message on failure — never a silent no-op (FR-040).
    announce(result.message, result.ok);
    if (result.ok) {
      setCopied(true);
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
      }
      timer.current = window.setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <IconButton
      label={copied ? 'Copied' : label}
      aria-label={copied ? 'Copied' : label}
      variant="ghost"
      onClick={() => void onClick()}
    >
      <Duplicate />
    </IconButton>
  );
};

export default CopyButton;
