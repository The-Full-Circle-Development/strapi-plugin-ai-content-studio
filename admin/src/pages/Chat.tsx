import * as React from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, getToolName, isToolUIPart, isFileUIPart, type UIMessage } from 'ai';
import { useAuth, Page, useNotification } from '@strapi/strapi/admin';
import { Loader } from '@strapi/design-system';
import { Sparkle, Paperclip, ArrowUp, Stop, Cross } from '@strapi/icons';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { styled } from 'styled-components';
import { LOADING_WORDS } from '../data/loadingWords';

const backendURL = (): string => {
  const w = window as unknown as { strapi?: { backendURL?: string } };
  return w.strapi?.backendURL ?? '';
};

interface UploadedMedia {
  id: number;
  name: string;
  url: string;
  mime: string;
}

/** Upload a file to Strapi's media library via the admin /upload endpoint (raw fetch + JWT). */
async function uploadToLibrary(file: File, token: string | null): Promise<UploadedMedia> {
  const formData = new FormData();
  formData.append('files', file);
  const res = await fetch(`${backendURL()}/upload`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const files = (await res.json()) as Array<{ id: number; name: string; url: string; mime: string }>;
  const f = files?.[0];
  if (!f) {
    throw new Error('upload returned no file');
  }
  return { id: f.id, name: f.name, url: f.url, mime: f.mime };
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

/** Convert File[] to AI SDK FileUIParts (data URLs) so a vision model can see them. */
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

/** Cycles through a random "working…" word while `active` (Claude Code-style). */
function useCyclingWord(active: boolean, words: string[], intervalMs = 2500): string {
  const pick = React.useCallback(
    () => words[Math.floor(Math.random() * words.length)] ?? 'Working',
    [words]
  );
  const [word, setWord] = React.useState<string>(pick);
  React.useEffect(() => {
    if (!active) {
      return undefined;
    }
    setWord(pick());
    const id = window.setInterval(() => setWord(pick()), intervalMs);
    return () => window.clearInterval(id);
  }, [active, pick, intervalMs]);
  return word;
}

const toolLabel = (state: string, name: string): { text: string; danger: boolean } => {
  switch (state) {
    case 'input-streaming':
    case 'input-available':
      return { text: `Using ${name}…`, danger: false };
    case 'output-available':
      return { text: `Used ${name}`, danger: false };
    case 'output-error':
      return { text: `${name} failed`, danger: true };
    default:
      return { text: name, danger: false };
  }
};

const SUGGESTIONS = [
  'List the content types I can edit',
  'Find the 5 most recent blog posts',
  'Draft a new service called "Heated Floors"',
  'What does the homepage hero say right now?',
];

/* ----------------------------------------------------------------------------- styling */

const COLUMN = '46rem';

const Shell = styled.div`
  display: flex;
  flex-direction: column;
  height: calc(100vh - 6rem);
  background: ${({ theme }) => theme.colors.neutral0};
`;

const Scroll = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 2rem 1.5rem 1rem;
`;

const Column = styled.div`
  width: 100%;
  max-width: ${COLUMN};
  margin: 0 auto;
`;

const Empty = styled.div`
  min-height: calc(100vh - 18rem);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 1.2rem;
`;

const EmptyLogo = styled.div`
  width: 4rem;
  height: 4rem;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${({ theme }) => theme.colors.primary100};
  color: ${({ theme }) => theme.colors.primary600};
  svg {
    width: 2rem;
    height: 2rem;
  }
`;

const Greeting = styled.div`
  font-size: 2rem;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.neutral800};
`;

const Suggestions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.8rem;
  justify-content: center;
  margin-top: 0.8rem;
`;

const Suggestion = styled.button`
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  background: ${({ theme }) => theme.colors.neutral0};
  color: ${({ theme }) => theme.colors.neutral700};
  border-radius: 1.2rem;
  padding: 0.7rem 1.2rem;
  font-size: 1.3rem;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
  &:hover {
    background: ${({ theme }) => theme.colors.neutral100};
    border-color: ${({ theme }) => theme.colors.neutral300};
  }
`;

const Turn = styled.div`
  margin-bottom: 2.4rem;
`;

const UserRow = styled(Turn)`
  display: flex;
  justify-content: flex-end;
`;

const UserBubble = styled.div`
  max-width: 85%;
  background: ${({ theme }) => theme.colors.primary100};
  color: ${({ theme }) => theme.colors.neutral800};
  border-radius: 1.4rem;
  padding: 0.9rem 1.3rem;
  font-size: 1.4rem;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
`;

const AssistantRow = styled(Turn)`
  display: flex;
  gap: 1rem;
  align-items: flex-start;
`;

const Avatar = styled.div`
  flex: 0 0 auto;
  width: 2.6rem;
  height: 2.6rem;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${({ theme }) => theme.colors.primary100};
  color: ${({ theme }) => theme.colors.primary600};
  svg {
    width: 1.5rem;
    height: 1.5rem;
  }
`;

const AssistantContent = styled.div`
  flex: 1;
  min-width: 0;
  padding-top: 0.3rem;
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  color: ${({ theme }) => theme.colors.neutral800};
`;

const ToolPill = styled.div<{ $danger?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  align-self: flex-start;
  font-size: 1.2rem;
  color: ${({ theme, $danger }) => ($danger ? theme.colors.danger600 : theme.colors.neutral600)};
  background: ${({ theme }) => theme.colors.neutral100};
  border: 1px solid ${({ theme }) => theme.colors.neutral150};
  border-radius: 1.2rem;
  padding: 0.4rem 0.9rem;
  &::before {
    content: '';
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    background: ${({ theme, $danger }) => ($danger ? theme.colors.danger600 : theme.colors.success600)};
  }
`;

const Working = styled.div`
  display: flex;
  align-items: center;
  gap: 0.8rem;
  color: ${({ theme }) => theme.colors.neutral500};
  font-size: 1.3rem;
`;

const MsgImage = styled.img`
  max-width: 22rem;
  max-height: 22rem;
  border-radius: 0.8rem;
  display: block;
`;

const MarkdownBody = styled.div`
  font-size: 1.4rem;
  line-height: 1.6;

  & > *:first-child {
    margin-top: 0;
  }
  & > *:last-child {
    margin-bottom: 0;
  }
  p {
    margin: 0 0 0.8rem;
  }
  strong {
    font-weight: 600;
  }
  ul,
  ol {
    margin: 0.4rem 0 0.8rem;
    padding-left: 2rem;
  }
  ul {
    list-style: disc;
  }
  ol {
    list-style: decimal;
  }
  li {
    margin: 0.2rem 0;
  }
  a {
    color: ${({ theme }) => theme.colors.primary600};
    text-decoration: underline;
  }
  h1,
  h2,
  h3,
  h4 {
    margin: 1rem 0 0.4rem;
    font-weight: 600;
    line-height: 1.3;
  }
  h1 {
    font-size: 1.8rem;
  }
  h2 {
    font-size: 1.6rem;
  }
  h3,
  h4 {
    font-size: 1.4rem;
  }
  code {
    font-family: 'Menlo', 'Consolas', monospace;
    font-size: 0.875em;
    background: ${({ theme }) => theme.colors.neutral150};
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
  }
  pre {
    margin: 0.4rem 0 0.8rem;
    padding: 0.8rem;
    overflow-x: auto;
    background: ${({ theme }) => theme.colors.neutral150};
    border-radius: 4px;
  }
  pre code {
    background: transparent;
    padding: 0;
    font-size: 0.8125rem;
  }
  blockquote {
    margin: 0.4rem 0;
    padding-left: 0.8rem;
    border-left: 3px solid ${({ theme }) => theme.colors.neutral200};
    color: ${({ theme }) => theme.colors.neutral600};
  }
  table {
    margin: 0.4rem 0 0.8rem;
    border-collapse: collapse;
  }
  th,
  td {
    padding: 0.4rem 0.8rem;
    border: 1px solid ${({ theme }) => theme.colors.neutral200};
    text-align: left;
  }
`;

const ComposerWrap = styled.div`
  padding: 0.5rem 1.5rem 1.5rem;
`;

const Composer = styled.div`
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  background: ${({ theme }) => theme.colors.neutral0};
  border-radius: 1.6rem;
  padding: 0.8rem 0.8rem 0.6rem;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  transition: border-color 120ms ease, box-shadow 120ms ease;
  &:focus-within {
    border-color: ${({ theme }) => theme.colors.primary600};
    box-shadow: 0 1px 6px rgba(0, 0, 0, 0.1);
  }
`;

const Thumbs = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  padding: 0.2rem 0.4rem 0.6rem;
`;

const Thumb = styled.div`
  position: relative;
  width: 4.4rem;
  height: 4.4rem;
  border-radius: 0.6rem;
  overflow: hidden;
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
`;

const ThumbRemove = styled.button`
  position: absolute;
  top: 0.2rem;
  right: 0.2rem;
  width: 1.7rem;
  height: 1.7rem;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  svg {
    width: 0.9rem;
    height: 0.9rem;
  }
  svg path {
    fill: #fff;
  }
`;

const Editor = styled.textarea`
  width: 100%;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  color: ${({ theme }) => theme.colors.neutral800};
  font-family: inherit;
  font-size: 1.4rem;
  line-height: 1.5;
  padding: 0.6rem 0.6rem 0.2rem;
  max-height: 18rem;
  &::placeholder {
    color: ${({ theme }) => theme.colors.neutral500};
  }
`;

const Bar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.2rem 0.2rem 0;
`;

const IconButton = styled.button`
  width: 3.2rem;
  height: 3.2rem;
  border-radius: 50%;
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  background: ${({ theme }) => theme.colors.neutral0};
  color: ${({ theme }) => theme.colors.neutral600};
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 120ms ease;
  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.colors.neutral100};
  }
  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
  svg {
    width: 1.7rem;
    height: 1.7rem;
  }
`;

const SendButton = styled(IconButton)`
  border: none;
  background: ${({ theme }) => theme.colors.primary600};
  color: #fff;
  svg path {
    fill: #fff;
  }
  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.colors.primary700};
  }
  &:disabled {
    background: ${({ theme }) => theme.colors.neutral200};
  }
`;

const Hint = styled.div`
  text-align: center;
  font-size: 1.1rem;
  color: ${({ theme }) => theme.colors.neutral500};
  margin-top: 0.6rem;
`;

const ErrorText = styled.div`
  color: ${({ theme }) => theme.colors.danger600};
  font-size: 1.3rem;
  margin-bottom: 1rem;
`;

/* ----------------------------------------------------------------------------- component */

export const Chat = () => {
  const { toggleNotification } = useNotification();

  // Admin JWT lives in Redux (not localStorage in Strapi 5.42); surface it via useAuth and keep
  // it in a ref so the transport's header function always reads the freshest token.
  const token = useAuth('AiContentStudioChat', (state) => state.token);
  const tokenRef = React.useRef<string | null>(token);
  React.useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  const transport = React.useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: `${backendURL()}/ai-content-studio/chat`,
        credentials: 'same-origin',
        headers: () => ({ Authorization: `Bearer ${tokenRef.current ?? ''}` }),
      }),
    []
  );

  const { messages, sendMessage, status, stop, error } = useChat({ transport });
  const [input, setInput] = React.useState('');
  const [attachments, setAttachments] = React.useState<File[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const editorRef = React.useRef<HTMLTextAreaElement>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);

  const busy = status === 'submitted' || status === 'streaming';
  const loadingWord = useCyclingWord(busy, LOADING_WORDS);
  const canSend = !busy && !uploading && (input.trim() !== '' || attachments.length > 0);

  // Object-URL thumbnails for composer chips (revoked on change/unmount).
  const [previews, setPreviews] = React.useState<string[]>([]);
  React.useEffect(() => {
    const urls = attachments.map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [attachments]);

  // Auto-scroll to the latest content.
  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, status]);

  // Auto-grow the editor.
  const autoGrow = React.useCallback(() => {
    const el = editorRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 288)}px`;
    }
  }, []);
  React.useEffect(() => {
    autoGrow();
  }, [input, autoGrow]);

  const onSend = async () => {
    const text = input.trim();
    if ((!text && attachments.length === 0) || busy || uploading) {
      return;
    }

    let mediaNote = '';
    let fileParts: Awaited<ReturnType<typeof filesToUIParts>> = [];

    if (attachments.length > 0) {
      setUploading(true);
      try {
        const uploaded = await Promise.all(
          attachments.map((file) => uploadToLibrary(file, tokenRef.current))
        );
        mediaNote =
          '\n\n[Attached image(s) uploaded to the media library — ' +
          uploaded.map((m) => `id ${m.id}: "${m.name}" (${m.mime}) ${m.url}`).join('; ') +
          ']';
        fileParts = await filesToUIParts(attachments);
      } catch (err) {
        toggleNotification({
          type: 'danger',
          message:
            err instanceof Error ? `Image upload failed: ${err.message}` : 'Image upload failed.',
        });
        setUploading(false);
        return;
      }
      setUploading(false);
    }

    const body = (text || 'Please look at the attached image(s).') + mediaNote;
    sendMessage(fileParts.length > 0 ? { text: body, files: fileParts } : { text: body });
    setInput('');
    setAttachments([]);
  };

  const onPasteImages = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = event.clipboardData?.items;
    if (!items) {
      return;
    }
    const images: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          const ext = (file.type.split('/')[1] || 'png').replace('+xml', '');
          images.push(
            file.name && file.name !== 'image.png'
              ? file
              : new File([file], `pasted-${images.length + 1}.${ext}`, { type: file.type })
          );
        }
      }
    }
    if (images.length > 0) {
      event.preventDefault();
      setAttachments((a) => [...a, ...images]);
    }
  };

  const renderImageParts = (message: UIMessage) =>
    message.parts.map((part, index) =>
      isFileUIPart(part) && part.mediaType?.startsWith('image/') ? (
        <MsgImage key={`img-${index}`} src={part.url} alt={part.filename ?? 'attachment'} />
      ) : null
    );

  return (
    <Page.Main>
      <Shell>
        <Scroll>
          <Column>
            {messages.length === 0 ? (
              <Empty>
                <EmptyLogo>
                  <Sparkle />
                </EmptyLogo>
                <Greeting>How can I help with your content?</Greeting>
                <Suggestions>
                  {SUGGESTIONS.map((s) => (
                    <Suggestion
                      key={s}
                      onClick={() => {
                        setInput(s);
                        editorRef.current?.focus();
                      }}
                    >
                      {s}
                    </Suggestion>
                  ))}
                </Suggestions>
              </Empty>
            ) : (
              messages.map((message) =>
                message.role === 'user' ? (
                  <UserRow key={message.id}>
                    <UserBubble>
                      {renderImageParts(message)}
                      {message.parts.map((part, index) =>
                        part.type === 'text' ? <span key={index}>{part.text}</span> : null
                      )}
                    </UserBubble>
                  </UserRow>
                ) : (
                  <AssistantRow key={message.id}>
                    <Avatar>
                      <Sparkle />
                    </Avatar>
                    <AssistantContent>
                      {message.parts.map((part, index) => {
                        if (part.type === 'text') {
                          return (
                            <MarkdownBody key={index}>
                              <Markdown remarkPlugins={[remarkGfm]}>{part.text}</Markdown>
                            </MarkdownBody>
                          );
                        }
                        if (part.type === 'reasoning') {
                          return (
                            <Working key={index} style={{ fontStyle: 'italic' }}>
                              {part.text}
                            </Working>
                          );
                        }
                        if (isToolUIPart(part)) {
                          const { text, danger } = toolLabel(part.state, String(getToolName(part)));
                          return (
                            <ToolPill key={index} $danger={danger}>
                              {text}
                            </ToolPill>
                          );
                        }
                        if (isFileUIPart(part) && part.mediaType?.startsWith('image/')) {
                          return (
                            <MsgImage key={index} src={part.url} alt={part.filename ?? 'image'} />
                          );
                        }
                        return null;
                      })}
                    </AssistantContent>
                  </AssistantRow>
                )
              )
            )}

            {status === 'submitted' ? (
              <AssistantRow>
                <Avatar>
                  <Sparkle />
                </Avatar>
                <AssistantContent>
                  <Working>
                    <Loader small>Working…</Loader>
                    {`${loadingWord}…`}
                  </Working>
                </AssistantContent>
              </AssistantRow>
            ) : null}

            {error ? <ErrorText>{error.message}</ErrorText> : null}
            <div ref={bottomRef} />
          </Column>
        </Scroll>

        <ComposerWrap>
          <Column>
            <Composer>
              {attachments.length > 0 ? (
                <Thumbs>
                  {attachments.map((file, i) => (
                    <Thumb key={`${file.name}-${i}`}>
                      {previews[i] ? <img src={previews[i]} alt={file.name} /> : null}
                      <ThumbRemove
                        type="button"
                        aria-label={`Remove ${file.name}`}
                        onClick={() => setAttachments((a) => a.filter((_, j) => j !== i))}
                      >
                        <Cross />
                      </ThumbRemove>
                    </Thumb>
                  ))}
                </Thumbs>
              ) : null}

              <Editor
                ref={editorRef}
                rows={1}
                value={input}
                placeholder="How can I help with your content?"
                onChange={(e) => setInput(e.target.value)}
                onInput={autoGrow}
                onPaste={onPasteImages}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void onSend();
                  }
                }}
              />

              <Bar>
                <IconButton
                  type="button"
                  aria-label="Attach image"
                  title="Attach image"
                  disabled={busy || uploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Paperclip />
                </IconButton>

                {busy ? (
                  <IconButton type="button" aria-label="Stop" title="Stop" onClick={() => stop()}>
                    <Stop />
                  </IconButton>
                ) : (
                  <SendButton
                    type="button"
                    aria-label="Send"
                    title="Send"
                    disabled={!canSend}
                    onClick={() => void onSend()}
                  >
                    <ArrowUp />
                  </SendButton>
                )}
              </Bar>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={(event) => {
                  const list = event.target.files;
                  if (list && list.length > 0) {
                    setAttachments((a) => [...a, ...Array.from(list)]);
                  }
                  event.target.value = '';
                }}
              />
            </Composer>
            <Hint>AI Content Studio can edit live content — review important changes.</Hint>
          </Column>
        </ComposerWrap>
      </Shell>
    </Page.Main>
  );
};

export default Chat;
