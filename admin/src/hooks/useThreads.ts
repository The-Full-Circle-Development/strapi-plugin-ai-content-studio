import * as React from 'react';
import { useAuth } from '@strapi/strapi/admin';

/**
 * The current conversation.
 *
 * A thread is resolved (or created) before the first message is sent, because `POST /chat` requires
 * a `threadId` — that is what makes a reply survive a reload. The server derives ownership from the
 * admin session, so nothing here sends an owner: another user's thread is simply a 404.
 */

export type ChatMode = 'content' | 'layout' | 'audit';

export interface ThreadSummary {
  id: string;
  title: string;
  mode: ChatMode;
  lastActivityAt: string;
  messageCount?: number;
}

export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant';
  sequence: number;
  parts: unknown[];
  attachmentManifest: Array<{ ordinal: number; filename: string; mimeType: string; sizeBytes: number }> | null;
  interrupted: boolean;
  modeAtSend: ChatMode;
  changeSetId: string | null;
}

export interface ThreadHistory extends ThreadSummary {
  contextCondensed: boolean;
  messages: StoredMessage[];
  expiredAttachments: Array<{ messageId: string; ordinals: number[] }>;
}

export const backendURL = (): string => {
  const w = window as unknown as { strapi?: { backendURL?: string } };
  return w.strapi?.backendURL ?? '';
};

const PLUGIN_BASE = '/ai-content-studio';

/** Thin fetch wrapper that attaches the admin JWT and turns a non-2xx into a readable Error. */
export async function adminFetch<T>(
  path: string,
  token: string | null,
  init: RequestInit = {}
): Promise<T> {
  const isForm = init.body instanceof FormData;
  const res = await fetch(`${backendURL()}${PLUGIN_BASE}${path}`, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 204) {
    return undefined as T;
  }
  const text = await res.text();
  let payload: any = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!res.ok) {
    // Server messages are already actionable and credential-free (FR-053) — surface them as-is.
    const message =
      payload?.error?.message ??
      payload?.message ??
      payload?.error ??
      `Request failed (HTTP ${res.status}).`;
    const err = new Error(typeof message === 'string' ? message : `Request failed (HTTP ${res.status}).`);
    (err as Error & { status?: number; payload?: unknown }).status = res.status;
    (err as Error & { status?: number; payload?: unknown }).payload = payload;
    throw err;
  }
  return payload as T;
}

export function useThreads() {
  const token = useAuth('AiContentStudioChat', (state) => state.token);
  const tokenRef = React.useRef<string | null>(token);
  React.useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  const [threads, setThreads] = React.useState<ThreadSummary[]>([]);
  const [currentThreadId, setCurrentThreadId] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<ChatMode>('content');
  const [loading, setLoading] = React.useState(false);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // The transport's body callback reads this synchronously, so it must be a ref, not state.
  const threadIdRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    threadIdRef.current = currentThreadId;
  }, [currentThreadId]);

  const modeRef = React.useRef<ChatMode>(mode);
  React.useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const refresh = React.useCallback(async (cursor?: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '30' });
      if (cursor) {
        params.set('cursor', cursor);
      }
      const page = await adminFetch<{ threads: ThreadSummary[]; nextCursor: string | null }>(
        `/threads?${params.toString()}`,
        tokenRef.current
      );
      setThreads((current) => (cursor ? [...current, ...page.threads] : page.threads));
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your conversations.');
    } finally {
      setLoading(false);
    }
  }, []);

  // The list is what makes a reload feel like a return rather than a fresh start (FR-016).
  React.useEffect(() => {
    if (token) {
      void refresh();
    }
  }, [token, refresh]);

  const createThread = React.useCallback(
    async (nextMode: ChatMode = 'content'): Promise<ThreadSummary> => {
      const thread = await adminFetch<ThreadSummary>('/threads', tokenRef.current, {
        method: 'POST',
        body: JSON.stringify({ mode: nextMode }),
      });
      threadIdRef.current = thread.id;
      setCurrentThreadId(thread.id);
      setMode(thread.mode);
      setThreads((current) => [thread, ...current.filter((t) => t.id !== thread.id)]);
      return thread;
    },
    []
  );

  /** Full history for a thread, in the shape `useChat` replays. */
  const loadHistory = React.useCallback(async (threadId: string): Promise<ThreadHistory | null> => {
    setError(null);
    try {
      const history = await adminFetch<ThreadHistory>(`/threads/${threadId}`, tokenRef.current);
      threadIdRef.current = history.id;
      setCurrentThreadId(history.id);
      setMode(history.mode);
      return history;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open that conversation.');
      return null;
    }
  }, []);

  const renameThread = React.useCallback(async (threadId: string, title: string) => {
    // Optimistic: the rename is a local edit to a list the server already agrees with.
    setThreads((current) => current.map((t) => (t.id === threadId ? { ...t, title } : t)));
    try {
      await adminFetch<ThreadSummary>(`/threads/${threadId}`, tokenRef.current, {
        method: 'PATCH',
        body: JSON.stringify({ title }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename that conversation.');
      await refresh();
    }
  }, [refresh]);

  const deleteThread = React.useCallback(
    async (threadId: string): Promise<boolean> => {
      try {
        await adminFetch<void>(`/threads/${threadId}`, tokenRef.current, { method: 'DELETE' });
        setThreads((current) => current.filter((t) => t.id !== threadId));
        if (threadIdRef.current === threadId) {
          threadIdRef.current = null;
          setCurrentThreadId(null);
        }
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not delete that conversation.');
        return false;
      }
    },
    []
  );

  /** Persist a mode change on the thread so it survives a reload (FR-028). */
  const changeMode = React.useCallback(
    async (nextMode: ChatMode) => {
      setMode(nextMode);
      modeRef.current = nextMode;
      const id = threadIdRef.current;
      if (!id) {
        // No thread yet — the mode rides along when one is created on the first send.
        return;
      }
      setThreads((current) => current.map((t) => (t.id === id ? { ...t, mode: nextMode } : t)));
      try {
        await adminFetch<ThreadSummary>(`/threads/${id}`, tokenRef.current, {
          method: 'PATCH',
          body: JSON.stringify({ mode: nextMode }),
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not change the mode.');
      }
    },
    []
  );

  /**
   * Guarantees a thread id exists before a send. Resolving lazily (rather than on mount) means
   * opening the panel and not typing leaves no empty conversation behind.
   */
  const ensureThread = React.useCallback(async (): Promise<string> => {
    if (threadIdRef.current) {
      return threadIdRef.current;
    }
    const thread = await createThread(modeRef.current);
    return thread.id;
  }, [createThread]);

  return {
    token,
    tokenRef,
    threads,
    currentThreadId,
    setCurrentThreadId,
    threadIdRef,
    mode,
    setMode,
    modeRef,
    changeMode,
    loading,
    hasMore: nextCursor !== null,
    loadMore: () => refresh(nextCursor),
    error,
    setError,
    refresh,
    createThread,
    ensureThread,
    loadHistory,
    renameThread,
    deleteThread,
  };
}

export default useThreads;
