import * as React from 'react';
import { getToolName, isToolUIPart, isFileUIPart, type UIMessage } from 'ai';
import { Loader, Typography } from '@strapi/design-system';
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

/** An interrupted turn reads as interrupted, not as a reply that simply trailed off (FR-024). */
const Interrupted = styled.div`
  align-self: stretch;
  font-size: 1.2rem;
  color: ${({ theme }) => theme.colors.warning700};
  background: ${({ theme }) => theme.colors.warning100};
  border: 1px solid ${({ theme }) => theme.colors.warning200};
  border-radius: 0.6rem;
  padding: 0.5rem 0.8rem;
`;

const Expired = styled.div`
  font-size: 1.15rem;
  font-style: italic;
  color: ${({ theme }) => theme.colors.warning600};
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

/** A `proposeChanges` tool result carries the id of the pending plan it recorded. */
const changeSetIdOf = (part: unknown): string | null => {
  const output = (part as { output?: { ok?: boolean; changeSetId?: string } }).output;
  return output?.ok && typeof output.changeSetId === 'string' ? output.changeSetId : null;
};

interface ApplyReportPart {
  changeSetId: string;
  appliedAt: string;
  items: Array<{
    id: string;
    field: string | null;
    documentLabel: string;
    resultingState: string;
    state: string;
    message: string | null;
    oldValue: unknown;
    newValue: unknown;
  }>;
}

const ReportBox = styled.div`
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: 0.8rem;
  padding: 0.9rem 1.1rem;
  align-self: stretch;
  font-size: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
`;

const ReportRow = styled.div<{ $tone: 'success' | 'danger' | 'warning' | 'neutral' }>`
  color: ${({ theme, $tone }) =>
    $tone === 'success'
      ? theme.colors.success600
      : $tone === 'danger'
        ? theme.colors.danger600
        : $tone === 'warning'
          ? theme.colors.warning600
          : theme.colors.neutral600};
  word-break: break-word;
`;

const REPORT_TONE: Record<string, 'success' | 'danger' | 'warning' | 'neutral'> = {
  applied: 'success',
  blocked: 'danger',
  failed: 'danger',
  stale: 'warning',
  skipped: 'neutral',
};

const showValue = (value: unknown): string => {
  if (value === null || value === undefined || value === '') {
    return '(empty)';
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

/**
 * The per-item apply report (FR-006). Rendered from a persisted `data-apply-report` part, so a
 * reload replays exactly the outcome the user first saw and the history stays auditable (FR-008).
 */
const ApplyReport = ({ report }: { report: ApplyReportPart }) => (
  <ReportBox>
    <Typography variant="pi" fontWeight="bold">
      Applied {new Date(report.appliedAt).toLocaleString()}
    </Typography>
    {report.items.map((item) => (
      <ReportRow key={item.id} $tone={REPORT_TONE[item.state] ?? 'neutral'}>
        <strong>{item.state}</strong> — {item.field ? `${item.field} on ` : ''}
        {item.documentLabel}
        {item.state === 'applied' ? (
          <>
            : {showValue(item.oldValue)} → {showValue(item.newValue)}
            {item.resultingState === 'unchanged' ? '' : ` (${item.resultingState})`}
          </>
        ) : item.message ? (
          <>: {item.message}</>
        ) : null}
      </ReportRow>
    ))}
  </ReportBox>
);

export interface MessageListProps {
  messages: UIMessage[];
  status: string;
  onPickSuggestion: (text: string) => void;
  /** Renders the plan card for a `proposeChanges` result. Supplied by the page shell. */
  renderChangeSet?: (changeSetId: string) => React.ReactNode;
  /** Ordinals of a restored thread's attachments that were never ingested (FR-038). */
  expiredOrdinalsByMessage?: Record<string, number[]>;
}

export const MessageList = ({
  messages,
  status,
  onPickSuggestion,
  renderChangeSet,
  expiredOrdinalsByMessage,
}: MessageListProps) => {
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
              {/*
                Held files live in browser memory and do not survive a reload, by design (FR-038).
                Say so plainly rather than leaving a silent gap, and invite re-attaching.
              */}
              {expiredOrdinalsByMessage?.[message.id]?.length ? (
                <Expired>
                  {expiredOrdinalsByMessage[message.id].map((o) => `#${o}`).join(', ')}{' '}
                  {expiredOrdinalsByMessage[message.id].length === 1 ? 'was' : 'were'} never added to
                  the Media Library and {expiredOrdinalsByMessage[message.id].length === 1 ? 'is' : 'are'}{' '}
                  no longer held. Re-attach {expiredOrdinalsByMessage[message.id].length === 1 ? 'it' : 'them'}{' '}
                  to continue.
                </Expired>
              ) : null}
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
                if (part.type === 'data-apply-report') {
                  return <ApplyReport key={index} report={(part as any).data as ApplyReportPart} />;
                }
                if (part.type === 'data-interrupted') {
                  const data = (part as any).data as {
                    applied?: Array<{ field: string | null; documentLabel: string; newValue: unknown }>;
                  };
                  return (
                    <Interrupted key={index}>
                      <strong>Stopped.</strong>{' '}
                      {data.applied?.length
                        ? `${data.applied.length} change${
                            data.applied.length === 1 ? '' : 's'
                          } had already been applied in this turn: ${data.applied
                            .map((a) => `${a.field ?? 'entry'} on ${a.documentLabel}`)
                            .join('; ')}.`
                        : 'Nothing was applied in this turn.'}
                    </Interrupted>
                  );
                }
                if (isToolUIPart(part)) {
                  const name = String(getToolName(part));
                  // A recorded plan renders as the approvable card, not as a bare tool pill —
                  // the card IS the approval surface (FR-002, FR-003).
                  if (name === 'proposeChanges' && part.state === 'output-available') {
                    const changeSetId = changeSetIdOf(part);
                    if (changeSetId && renderChangeSet) {
                      return (
                        <React.Fragment key={index}>{renderChangeSet(changeSetId)}</React.Fragment>
                      );
                    }
                  }
                  const { text, danger } = toolLabel(part.state, name);
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
