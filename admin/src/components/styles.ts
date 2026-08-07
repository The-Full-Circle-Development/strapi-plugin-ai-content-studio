import { styled } from 'styled-components';

/**
 * Styled primitives shared by more than one chat component.
 *
 * These moved out of `pages/Chat.tsx` verbatim when that file was split (R12) — the visual result
 * is unchanged. `@strapi/design-system` v2 + styled-components only; no new UI dependency.
 */

export const COLUMN_WIDTH = '46rem';

export const Shell = styled.div`
  display: flex;
  flex-direction: column;
  height: calc(100vh - 6rem);
  background: ${({ theme }) => theme.colors.neutral0};
`;

export const Scroll = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 2rem 1.5rem 1rem;
`;

export const Column = styled.div`
  width: 100%;
  max-width: ${COLUMN_WIDTH};
  margin: 0 auto;
`;

export const Turn = styled.div`
  margin-bottom: 2.4rem;
`;

export const UserRow = styled(Turn)`
  display: flex;
  justify-content: flex-end;
`;

export const UserBubble = styled.div`
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

export const AssistantRow = styled(Turn)`
  display: flex;
  gap: 1rem;
  align-items: flex-start;
`;

export const Avatar = styled.div`
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

export const AssistantContent = styled.div`
  flex: 1;
  min-width: 0;
  padding-top: 0.3rem;
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  color: ${({ theme }) => theme.colors.neutral800};
`;

export const Working = styled.div`
  display: flex;
  align-items: center;
  gap: 0.8rem;
  color: ${({ theme }) => theme.colors.neutral500};
  font-size: 1.3rem;
`;

export const MsgImage = styled.img`
  max-width: 22rem;
  max-height: 22rem;
  border-radius: 0.8rem;
  display: block;
`;

export const IconButton = styled.button`
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

export const ErrorText = styled.div`
  color: ${({ theme }) => theme.colors.danger600};
  font-size: 1.3rem;
  margin-bottom: 1rem;
`;

export const MarkdownBody = styled.div`
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
