import * as React from 'react';
import { useClipboard } from '@strapi/strapi/admin';

/**
 * Copy to the clipboard: attempt, fall back, then FAIL OUT LOUD (FR-040, research D13).
 *
 * A THIN WRAPPER over Strapi's own `useClipboard()` — the same specifier this repo already imports
 * `useNotification` and `useFetchClient` from. Verified in the installed `@strapi/admin@5.48.1`:
 *
 *   useClipboard: () => { copy: (value: string | number) => Promise<boolean> }
 *
 * and its implementation already guards non-string and empty input, returning `false` rather than
 * throwing. So none of that is re-implemented here.
 *
 * WHAT STAYS OURS IS ONLY THE INSECURE-CONTEXT FALLBACK. `useClipboard` calls
 * `navigator.clipboard.writeText` and nothing else — there is no `document.execCommand` path in it,
 * confirmed by reading the hook's source. That fallback is the entire reason research D13 exists:
 * `navigator.clipboard` requires a secure context, and a Strapi admin panel served over plain HTTP
 * on a LAN host is NOT one — common enough in the self-hosted deployments this plugin targets that a
 * single-path implementation would simply appear broken.
 *
 * The last step is a VISIBLE FAILURE, never a swallowed rejection: FR-040 forbids a silent no-op.
 */

export interface CopyResult {
  ok: boolean;
  /** English, user-facing. Present on failure; the caller announces it. */
  message: string;
}

/**
 * Hidden-textarea + `execCommand('copy')`, the pre-secure-context mechanism.
 *
 * `execCommand` is deprecated, and that is fine: it is reached only when the modern API is absent,
 * which is exactly the browser state where the deprecated one still works.
 */
const copyViaExecCommand = (value: string): boolean => {
  const textarea = document.createElement('textarea');
  textarea.value = value;
  // Keep it out of view and out of the tab order, and do not let it scroll the page.
  textarea.setAttribute('readonly', '');
  textarea.setAttribute('aria-hidden', 'true');
  textarea.tabIndex = -1;
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  try {
    textarea.select();
    textarea.setSelectionRange(0, value.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
};

export function useCopy() {
  const { copy: strapiCopy } = useClipboard();

  const copy = React.useCallback(
    async (value: string): Promise<CopyResult> => {
      // A control must never copy nothing while presenting success (FR-043).
      if (typeof value !== 'string' || value === '') {
        return { ok: false, message: 'There is nothing to copy.' };
      }

      if (await strapiCopy(value)) {
        return { ok: true, message: 'Copied to the clipboard.' };
      }

      if (copyViaExecCommand(value)) {
        return { ok: true, message: 'Copied to the clipboard.' };
      }

      return {
        ok: false,
        message:
          'Could not copy to the clipboard. Your browser blocked it — this usually happens when the admin panel is not served over HTTPS. Select the text and copy it manually.',
      };
    },
    [strapiCopy]
  );

  return { copy };
}

export default useCopy;
