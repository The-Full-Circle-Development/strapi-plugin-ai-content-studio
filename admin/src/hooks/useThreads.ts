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

  const [currentThreadId, setCurrentThreadId] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<ChatMode>('content');
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

  const createThread = React.useCallback(
    async (nextMode: ChatMode = 'content'): Promise<ThreadSummary> => {
      const thread = await adminFetch<ThreadSummary>('/threads', tokenRef.current, {
        method: 'POST',
        body: JSON.stringify({ mode: nextMode }),
      });
      threadIdRef.current = thread.id;
      setCurrentThreadId(thread.id);
      setMode(thread.mode);
      return thread;
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
    currentThreadId,
    setCurrentThreadId,
    threadIdRef,
    mode,
    setMode,
    modeRef,
    error,
    setError,
    createThread,
    ensureThread,
  };
}

export default useThreads;
