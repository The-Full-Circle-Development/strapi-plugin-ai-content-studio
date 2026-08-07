import * as React from 'react';
import { getToolName, isToolUIPart, isFileUIPart, type UIMessage } from 'ai';
import { Loader } from '@strapi/design-system';
import { Sparkle } from '@strapi/icons';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { styled } from 'styled-components';
import { LOADING_WORDS } from '../data/loadingWords';
import {
  AssistantContent,
  AssistantRow,
  Avatar,
  MarkdownBody,
  MsgImage,
  UserBubble,
  UserRow,
  Working,
} from './styles';

/** Rendered transcript. Owns no chat state — the page shell passes messages and status in. */

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

export const SUGGESTIONS = [
  'List the content types I can edit',
  'Find the 5 most recent blog posts',
  'Draft a new service called "Heated Floors"',
  'What does the homepage hero say right now?',
];

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

export interface MessageListProps {
  messages: UIMessage[];
  status: string;
  onPickSuggestion: (text: string) => void;
}

export const MessageList = ({ messages, status, onPickSuggestion }: MessageListProps) => {
  const busy = status === 'submitted' || status === 'streaming';
  const loadingWord = useCyclingWord(busy, LOADING_WORDS);

  const renderImageParts = (message: UIMessage) =>
    message.parts.map((part, index) =>
      isFileUIPart(part) && part.mediaType?.startsWith('image/') ? (
        <MsgImage key={`img-${index}`} src={part.url} alt={part.filename ?? 'attachment'} />
      ) : null
    );

  if (messages.length === 0) {
    return (
      <Empty>
        <EmptyLogo>
          <Sparkle />
        </EmptyLogo>
        <Greeting>How can I help with your content?</Greeting>
        <Suggestions>
          {SUGGESTIONS.map((s) => (
            <Suggestion key={s} onClick={() => onPickSuggestion(s)}>
              {s}
            </Suggestion>
          ))}
        </Suggestions>
      </Empty>
    );
  }

  return (
    <>
      {messages.map((message) =>
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
                  return <MsgImage key={index} src={part.url} alt={part.filename ?? 'image'} />;
                }
                return null;
              })}
            </AssistantContent>
          </AssistantRow>
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
    </>
  );
};

export default MessageList;
