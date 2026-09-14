import * as React from 'react';
import { useAuth } from '@strapi/strapi/admin';
import { adminFetch } from './useThreads';

/**
 * The conversation's Focus — the one entry the editor is pointing at
 * (005 contracts/situation-and-focus.md §1).
 *
 * SET BY THE EDITOR, NEVER OBSERVED. This plugin does not watch Content Manager navigation: that
 * would bind the admin bundle to internals that shift across Strapi upgrades, and it would silently
 * assume a wrong entry. One deliberate action buys "this page" resolving without being named again.
 *
 * IT GRANTS NOTHING. Everything this hook holds is a VIEW: the server re-resolves the focus and
 * re-checks the caller's permissions on every turn, so a stale label here cannot become a claim.
 */

export interface FocusValue {
  uid: string;
  documentId: string | null;
  locale: string | null;
  label: string;
  setAt: string;
}

export interface FocusContentType {
  uid: string;
  displayName: string;
  kind: string;
  localized: boolean;
}

export interface FocusCandidate {
  documentId: string | null;
  label: string;
  locale: string | null;
}

export interface FocusOptions {
  contentTypes: FocusContentType[];
  locales: string[];
  defaultLocale: string | null;
  /**
   * The single flag every surface keys on (FR-042, SC-018). False on an install with one locale OR
   * none, because those are indistinguishable: there is nothing to choose between, so the picker
   * renders no language control at all.
   */
  multiLocale: boolean;
}

export const useFocus = (threadId: string | null) => {
  const token = useAuth('AiContentStudioFocus', (state) => state.token);
  const tokenRef = React.useRef<string | null>(token);
  React.useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  const [focus, setFocusState] = React.useState<FocusValue | null>(null);
  const [options, setOptions] = React.useState<FocusOptions | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  /**
   * The pickable content types and the install's locales.
   *
   * Loaded once per mount rather than per open: the list is filtered by the caller's own
   * permissions server-side and changes only when their roles do, and re-fetching it on every
   * picker open would make the control feel slower for no freshness anyone would notice.
   */
  const loadOptions = React.useCallback(async () => {
    try {
      setOptions(await adminFetch<FocusOptions>('/focus/content-types', tokenRef.current));
    } catch {
      // A picker with no options is a disabled picker, never a broken chat.
      setOptions({ contentTypes: [], locales: [], defaultLocale: null, multiLocale: false });
    }
  }, []);

  /** Candidate entries for one content type, optionally narrowed by a search and a locale. */
  const searchEntries = React.useCallback(
    async (uid: string, q: string, locale: string | null): Promise<FocusCandidate[]> => {
      const params = new URLSearchParams({ uid });
      if (q.trim() !== '') {
        params.set('q', q.trim());
      }
      if (locale) {
        params.set('locale', locale);
      }
      try {
        const result = await adminFetch<{ entries: FocusCandidate[] }>(
          `/focus/entries?${params.toString()}`,
          tokenRef.current
        );
        return result.entries ?? [];
      } catch {
        return [];
      }
    },
    []
  );

  const set = React.useCallback(
    async (input: { uid: string; documentId?: string | null; locale?: string | null }) => {
      if (!threadId) {
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const result = await adminFetch<{ focus: FocusValue }>(
          `/threads/${threadId}/focus`,
          tokenRef.current,
          {
            method: 'PUT',
            body: JSON.stringify({
              uid: input.uid,
              ...(input.documentId ? { documentId: input.documentId } : {}),
              ...(input.locale ? { locale: input.locale } : {}),
            }),
          }
        );
        setFocusState(result.focus);
      } catch (err) {
        // The server's message is already safe to show: a permission denial names the permission
        // and never the entry, and a missing language version is distinguished from a missing entry.
        setError(err instanceof Error ? err.message : 'Could not set the focus.');
      } finally {
        setBusy(false);
      }
    },
    [threadId]
  );

  const clear = React.useCallback(async () => {
    if (!threadId) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await adminFetch(`/threads/${threadId}/focus`, tokenRef.current, { method: 'DELETE' });
      setFocusState(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not clear the focus.');
    } finally {
      setBusy(false);
    }
  }, [threadId]);

  /**
   * Adopt the focus a reopened conversation came back with (US3-7).
   *
   * The thread history carries it, so there is no extra request: the shell hands it here when it
   * loads a thread, and switching threads replaces it rather than leaving the previous one on screen.
   */
  const adopt = React.useCallback((value: FocusValue | null) => {
    setFocusState(value);
    setError(null);
  }, []);

  return { focus, options, busy, error, loadOptions, searchEntries, set, clear, adopt };
};

export default useFocus;
