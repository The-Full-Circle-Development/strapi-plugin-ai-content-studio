import * as React from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { Page, useNotification } from '@strapi/strapi/admin';
import { MessageList } from '../components/MessageList';
import { Composer } from '../components/Composer';
import { ChangePlanCard, type ApplyReport } from '../components/ChangePlanCard';
import { Column, ErrorText, Scroll, Shell } from '../components/styles';
import { backendURL, useThreads } from '../hooks/useThreads';

/**
 * Chat page shell.
 *
 * This file used to be 814 lines and owned the transcript, the composer, the styling and the
 * upload behaviour. It is now a shell over `components/` + `hooks/` (R12): it owns the transport,
 * the `useChat` instance, and the wiring between them — nothing else.
 */

/** Convert File[] to AI SDK FileUIParts (data URLs) so a vision model can see them. */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

async function filesToUIParts(files: File[]) {
  return Promise.all(
    files.map(async (file) => ({
      type: 'file' as const,
      mediaType: file.type || 'application/octet-stream',
      filename: file.name,
      url: await fileToDataUrl(file),
    }))
  );
}

export const Chat = () => {
  const { toggleNotification } = useNotification();
  const { tokenRef, threadIdRef, modeRef, ensureThread } = useThreads();

  // The transport reads the freshest token AND the current thread id per request, so a thread
  // created lazily on the first send is already in the body.
  const transport = React.useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: `${backendURL()}/ai-content-studio/chat`,
        credentials: 'same-origin',
        headers: () => ({ Authorization: `Bearer ${tokenRef.current ?? ''}` }),
        body: () => ({ threadId: threadIdRef.current, mode: modeRef.current }),
      }),
    [tokenRef, threadIdRef, modeRef]
  );

  const { messages, sendMessage, setMessages, status, stop, error } = useChat({ transport });
  const [input, setInput] = React.useState('');
  const [attachments, setAttachments] = React.useState<File[]>([]);
  const [preparing, setPreparing] = React.useState(false);
  const bottomRef = React.useRef<HTMLDivElement>(null);

  const busy = status === 'submitted' || status === 'streaming';
  const canSend = !busy && !preparing && (input.trim() !== '' || attachments.length > 0);

  // Auto-scroll to the latest content.
  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, status]);

  const onSend = async () => {
    const text = input.trim();
    if ((!text && attachments.length === 0) || busy || preparing) {
      return;
    }

    setPreparing(true);
    try {
      // A thread must exist before the request goes out — the server requires threadId.
      await ensureThread();
      const fileParts = attachments.length > 0 ? await filesToUIParts(attachments) : [];
      const body = text || 'Please look at the attached file(s).';
      sendMessage(fileParts.length > 0 ? { text: body, files: fileParts } : { text: body });
      setInput('');
      setAttachments([]);
    } catch (err) {
      toggleNotification({
        type: 'danger',
        message: err instanceof Error ? err.message : 'Could not start the conversation.',
      });
    } finally {
      setPreparing(false);
    }
  };

  /**
   * The per-item apply report is appended to the conversation as an assistant turn, so the outcome
   * (field, old value, new value, draft/published state, and every blocked or failed reason) sits
   * in the transcript rather than in a toast (FR-006, FR-008). The server persists the same report
   * on the thread, so a reload replays it.
   */
  const onApplied = React.useCallback(
    (report: ApplyReport) => {
      setMessages((current) => [
        ...current,
        {
          id: `apply-${report.changeSetId}-${current.length}`,
          role: 'assistant',
          parts: [{ type: 'data-apply-report', data: report }],
        } as UIMessage,
      ]);
    },
    [setMessages]
  );

  return (
    <Page.Main>
      <Shell>
        <Scroll>
          <Column>
            <MessageList
              messages={messages}
              status={status}
              onPickSuggestion={(text) => setInput(text)}
              renderChangeSet={(changeSetId) => (
                <ChangePlanCard changeSetId={changeSetId} onApplied={onApplied} />
              )}
            />
            {error ? <ErrorText>{error.message}</ErrorText> : null}
            <div ref={bottomRef} />
          </Column>
        </Scroll>

        <Composer
          input={input}
          onInputChange={setInput}
          attachments={attachments}
          onAddFiles={(files) => setAttachments((a) => [...a, ...files])}
          onRemoveAttachment={(index) => setAttachments((a) => a.filter((_, j) => j !== index))}
          busy={busy}
          disabled={preparing}
          canSend={canSend}
          onSend={() => void onSend()}
          onStop={() => stop()}
        />
      </Shell>
    </Page.Main>
  );
};

export default Chat;
