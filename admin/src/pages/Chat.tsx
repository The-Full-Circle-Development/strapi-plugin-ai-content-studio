import * as React from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, getToolName, isToolUIPart, type UIMessage } from 'ai';
import { useAuth, Page } from '@strapi/strapi/admin';
import { useIntl } from 'react-intl';
import { Box, Flex, Typography, Textarea, Button, Loader, Status } from '@strapi/design-system';
import { getTranslation } from '../utils/getTranslation';

const backendURL = (): string => {
  const w = window as unknown as { strapi?: { backendURL?: string } };
  return w.strapi?.backendURL ?? '';
};

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

  const { messages, sendMessage, status, stop, error } = useChat({ transport });
  const [input, setInput] = React.useState('');
  const busy = status === 'submitted' || status === 'streaming';

  const onSend = () => {
    const text = input.trim();
    if (!text || busy) {
      return;
    }
    sendMessage({ text });
    setInput('');
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
                      <Typography key={index} tag="p">
                        {part.text}
                      </Typography>
                    );
                  }

                  if (part.type === 'reasoning') {
                    return (
                      <Typography key={index} variant="pi" textColor="neutral500" fontWeight="regular">
                        {part.text}
                      </Typography>
                    );
                  }

                  if (isToolUIPart(part)) {
                    const name = getToolName(part);
                    const { text, danger } = toolStateLabel(part.state, String(name));
                    return (
                      <Box key={index} padding={2} background="neutral0" hasRadius>
                        <Status variant={danger ? 'danger' : 'secondary'} size="S">
                          <Typography variant="omega">{text}</Typography>
                        </Status>
                        {'input' in part && part.input != null ? (
                          <Box paddingTop={1}>
                            <Typography variant="pi" textColor="neutral600">
                              {JSON.stringify(part.input)}
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

          {status === 'submitted' ? (
            <Loader small>
              {formatMessage({ id: getTranslation('chat.thinking'), defaultMessage: 'Thinking…' })}
            </Loader>
          ) : null}

          {error ? (
            <Typography textColor="danger600">{error.message}</Typography>
          ) : null}
        </Flex>

        <Box marginTop={4}>
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
          <Flex gap={2} marginTop={2}>
            <Button onClick={onSend} disabled={busy || input.trim() === ''} loading={status === 'submitted'}>
              {formatMessage({ id: getTranslation('chat.send'), defaultMessage: 'Send' })}
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
