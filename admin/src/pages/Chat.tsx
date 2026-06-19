import * as React from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, getToolName, isToolUIPart, isFileUIPart, type UIMessage } from 'ai';
import { useAuth, Page, useNotification } from '@strapi/strapi/admin';
import { useIntl } from 'react-intl';
import { Box, Flex, Typography, Textarea, Button, Loader, Status } from '@strapi/design-system';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { styled } from 'styled-components';
import { getTranslation } from '../utils/getTranslation';
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
    // Do NOT set Content-Type — the browser adds the multipart boundary.
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

/**
 * Renders assistant markdown (bold, lists, inline code, code blocks, links, tables) using
 * Strapi theme tokens so it matches the admin (and adapts to light/dark). react-markdown does
 * NOT render raw HTML, so this is XSS-safe.
 */
const MarkdownBody = styled.div`
  font-size: 1.4rem;
  line-height: 1.5;

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
  em {
    font-style: italic;
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

/**
 * Cycles through a random "working…" word while `active`, changing every `intervalMs`
 * (Claude Code-style). Returns the current word.
 */
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

const toolStateLabel = (state: string, name: string): { text: string; danger: boolean } => {
  switch (state) {
    case 'input-streaming':
    case 'input-available':
      return { text: `Running tool: ${name}…`, danger: false };
    case 'output-available':
      return { text: `Tool ${name} finished`, danger: false };
    case 'output-error':
      return { text: `Tool ${name} failed`, danger: true };
    default:
      return { text: `Tool ${name}`, danger: false };
  }
};

export const Chat = () => {
  const { formatMessage } = useIntl();

  // The admin JWT lives in Redux (not localStorage in Strapi 5.42); surface it via useAuth.
  // Keep it in a ref so the transport's header function always reads the freshest token.
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

  const { toggleNotification } = useNotification();
  const { messages, sendMessage, status, stop, error } = useChat({ transport });
  const [input, setInput] = React.useState('');
  const [attachments, setAttachments] = React.useState<File[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const busy = status === 'submitted' || status === 'streaming';
  const loadingWord = useCyclingWord(busy, LOADING_WORDS);

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
        // Upload to the media library (so the assistant can set/replace fields by id) AND
        // attach as data-URL file parts (so a vision model can analyze the image).
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

  // Paste images straight from the clipboard (e.g. a screenshot) into the attachments.
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

  return (
    <Page.Main>
      <Box padding={6}>
        <Typography variant="alpha" tag="h1">
          {formatMessage({ id: getTranslation('chat.title'), defaultMessage: 'AI Content Studio' })}
        </Typography>
        <Box paddingTop={2}>
          <Typography variant="epsilon" textColor="neutral600">
            {formatMessage({
              id: getTranslation('chat.subtitle'),
              defaultMessage: 'Ask the assistant to find, draft, edit, or publish content.',
            })}
          </Typography>
        </Box>

        <Flex direction="column" alignItems="stretch" gap={3} marginTop={6}>
          {messages.map((message) => (
            <Box
              key={message.id}
              padding={4}
              hasRadius
              background={message.role === 'user' ? 'primary100' : 'neutral100'}
            >
              <Typography variant="sigma" textColor="neutral600">
                {message.role === 'user'
                  ? formatMessage({ id: getTranslation('chat.you'), defaultMessage: 'You' })
                  : formatMessage({ id: getTranslation('chat.assistant'), defaultMessage: 'Assistant' })}
              </Typography>

              <Flex direction="column" alignItems="stretch" gap={2} marginTop={2}>
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
                      <Typography key={index} variant="pi" textColor="neutral500" fontWeight="regular">
                        {part.text}
                      </Typography>
                    );
                  }

                  if (isFileUIPart(part)) {
                    if (part.mediaType?.startsWith('image/')) {
                      return (
                        <img
                          key={index}
                          src={part.url}
                          alt={part.filename ?? 'attachment'}
                          style={{
                            maxWidth: 240,
                            maxHeight: 240,
                            borderRadius: 4,
                            display: 'block',
                          }}
                        />
                      );
                    }
                    return (
                      <Typography key={index} variant="pi" textColor="neutral600">
                        {`📎 ${part.filename ?? 'file'}`}
                      </Typography>
                    );
                  }

                  if (isToolUIPart(part)) {
                    const name = getToolName(part);
                    const { text, danger } = toolStateLabel(part.state, String(name));
                    const rawInput = 'input' in part ? part.input : undefined;
                    const inputStr =
                      rawInput == null
                        ? ''
                        : typeof rawInput === 'string'
                          ? rawInput
                          : JSON.stringify(rawInput);
                    // Hide empty/no-arg tool inputs (e.g. listContentTypes -> "{}").
                    const showInput = inputStr !== '' && inputStr !== '{}' && inputStr !== 'null';
                    return (
                      <Box key={index} padding={2} background="neutral0" hasRadius>
                        <Status variant={danger ? 'danger' : 'secondary'} size="S">
                          <Typography variant="omega">{text}</Typography>
                        </Status>
                        {showInput ? (
                          <Box paddingTop={1}>
                            <Typography variant="pi" textColor="neutral600">
                              {inputStr}
                            </Typography>
                          </Box>
                        ) : null}
                      </Box>
                    );
                  }

                  return null;
                })}
              </Flex>
            </Box>
          ))}

          {busy ? (
            <Flex gap={2} alignItems="center" paddingTop={1}>
              <Loader small>
                {formatMessage({ id: getTranslation('chat.thinking'), defaultMessage: 'Working…' })}
              </Loader>
              <Typography variant="omega" textColor="neutral600">
                {`${loadingWord}…`}
              </Typography>
            </Flex>
          ) : null}

          {error ? (
            <Typography textColor="danger600">{error.message}</Typography>
          ) : null}
        </Flex>

        <Box marginTop={4}>
          {attachments.length > 0 ? (
            <Flex gap={2} marginBottom={2} wrap="wrap">
              {attachments.map((file, i) => (
                <Flex
                  key={`${file.name}-${i}`}
                  gap={1}
                  alignItems="center"
                  background="neutral100"
                  paddingLeft={2}
                  paddingRight={1}
                  paddingTop={1}
                  paddingBottom={1}
                  hasRadius
                >
                  <Typography variant="pi">{file.name}</Typography>
                  <Button
                    variant="tertiary"
                    size="S"
                    onClick={() => setAttachments((a) => a.filter((_, j) => j !== i))}
                  >
                    ✕
                  </Button>
                </Flex>
              ))}
            </Flex>
          ) : null}

          <Textarea
            name="prompt"
            aria-label="prompt"
            value={input}
            onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setInput(event.target.value)}
            placeholder={formatMessage({
              id: getTranslation('chat.placeholder'),
              defaultMessage: 'Ask the assistant to draft, search, or create content…',
            })}
            onKeyDown={(event: React.KeyboardEvent) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                onSend();
              }
            }}
          />

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              const list = event.target.files;
              if (list && list.length > 0) {
                setAttachments((a) => [...a, ...Array.from(list)]);
              }
              event.target.value = '';
            }}
          />

          <Flex gap={2} marginTop={2}>
            <Button
              onClick={onSend}
              disabled={busy || uploading || (input.trim() === '' && attachments.length === 0)}
              loading={status === 'submitted' || uploading}
            >
              {formatMessage({ id: getTranslation('chat.send'), defaultMessage: 'Send' })}
            </Button>
            <Button
              variant="secondary"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy || uploading}
            >
              {formatMessage({ id: getTranslation('chat.attach'), defaultMessage: 'Attach image' })}
            </Button>
            {busy ? (
              <Button variant="danger-light" onClick={() => stop()}>
                {formatMessage({ id: getTranslation('chat.stop'), defaultMessage: 'Stop' })}
              </Button>
            ) : null}
          </Flex>
        </Box>
      </Box>
    </Page.Main>
  );
};

export default Chat;
