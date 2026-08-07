import * as React from 'react';
import { Button, IconButton as DSIconButton, Typography } from '@strapi/design-system';
import { Plus, Pencil, Trash, Check, Cross } from '@strapi/icons';
import { styled } from 'styled-components';
import type { ThreadSummary } from '../hooks/useThreads';

/**
 * The caller's own conversations, most-recent-first (FR-018).
 *
 * Only the owner's threads ever reach this list — the server has no way to ask for anyone else's,
 * super-admin included (FR-017).
 */

const Aside = styled.aside`
  width: 24rem;
  flex: 0 0 24rem;
  display: flex;
  flex-direction: column;
  border-right: 1px solid ${({ theme }) => theme.colors.neutral150};
  background: ${({ theme }) => theme.colors.neutral100};
`;

const Head = styled.div`
  padding: 1.2rem 1.2rem 0.8rem;
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
`;

const List = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 0 0.6rem 1.2rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
`;

const Item = styled.div<{ $active?: boolean }>`
  display: flex;
  align-items: center;
  gap: 0.4rem;
  border-radius: 0.6rem;
  padding: 0.5rem 0.6rem;
  background: ${({ theme, $active }) => ($active ? theme.colors.primary100 : 'transparent')};
  &:hover {
    background: ${({ theme, $active }) => ($active ? theme.colors.primary100 : theme.colors.neutral150)};
  }
`;

const Open = styled.button`
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
`;

const Title = styled.span`
  font-size: 1.3rem;
  color: ${({ theme }) => theme.colors.neutral800};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const When = styled.span`
  font-size: 1.1rem;
  color: ${({ theme }) => theme.colors.neutral600};
`;

const RenameInput = styled.input`
  flex: 1;
  min-width: 0;
  font-size: 1.3rem;
  font-family: inherit;
  padding: 0.3rem 0.5rem;
  border: 1px solid ${({ theme }) => theme.colors.primary600};
  border-radius: 0.4rem;
  background: ${({ theme }) => theme.colors.neutral0};
  color: ${({ theme }) => theme.colors.neutral800};
`;

const Empty = styled.div`
  padding: 1.2rem;
  font-size: 1.2rem;
  color: ${({ theme }) => theme.colors.neutral600};
`;

/** "3 minutes ago" / "yesterday" style, without pulling in a date library. */
const relative = (iso: string): string => {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) {
    return '';
  }
  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} h ago`;
  }
  const days = Math.round(hours / 24);
  if (days === 1) {
    return 'yesterday';
  }
  if (days < 30) {
    return `${days} days ago`;
  }
  return new Date(iso).toLocaleDateString();
};

export interface ThreadSidebarProps {
  threads: ThreadSummary[];
  currentThreadId: string | null;
  loading?: boolean;
  hasMore?: boolean;
  onSelect: (threadId: string) => void;
  onNew: () => void;
  onRename: (threadId: string, title: string) => void;
  onDelete: (threadId: string) => void;
  onLoadMore?: () => void;
  header?: React.ReactNode;
}

export const ThreadSidebar = ({
  threads,
  currentThreadId,
  loading = false,
  hasMore = false,
  onSelect,
  onNew,
  onRename,
  onDelete,
  onLoadMore,
  header,
}: ThreadSidebarProps) => {
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState('');

  const startRename = (thread: ThreadSummary) => {
    setRenamingId(thread.id);
    setDraft(thread.title);
  };

  const commitRename = () => {
    if (renamingId && draft.trim() !== '') {
      onRename(renamingId, draft.trim());
    }
    setRenamingId(null);
    setDraft('');
  };

  return (
    <Aside>
      <Head>
        <Button startIcon={<Plus />} onClick={onNew} fullWidth>
          New conversation
        </Button>
        {header}
      </Head>

      <List>
        {threads.length === 0 && !loading ? (
          <Empty>No conversations yet. Ask something to start one.</Empty>
        ) : null}

        {threads.map((thread) => (
          <Item key={thread.id} $active={thread.id === currentThreadId}>
            {renamingId === thread.id ? (
              <>
                <RenameInput
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitRename();
                    }
                    if (e.key === 'Escape') {
                      setRenamingId(null);
                    }
                  }}
                  aria-label="Conversation title"
                />
                <DSIconButton label="Save title" variant="ghost" onClick={commitRename}>
                  <Check />
                </DSIconButton>
                <DSIconButton label="Cancel" variant="ghost" onClick={() => setRenamingId(null)}>
                  <Cross />
                </DSIconButton>
              </>
            ) : (
              <>
                <Open onClick={() => onSelect(thread.id)} title={thread.title}>
                  <Title>{thread.title}</Title>
                  <When>
                    {relative(thread.lastActivityAt)}
                    {typeof thread.messageCount === 'number' ? ` · ${thread.messageCount} messages` : ''}
                  </When>
                </Open>
                <DSIconButton label="Rename" variant="ghost" onClick={() => startRename(thread)}>
                  <Pencil />
                </DSIconButton>
                <DSIconButton label="Delete" variant="ghost" onClick={() => onDelete(thread.id)}>
                  <Trash />
                </DSIconButton>
              </>
            )}
          </Item>
        ))}

        {hasMore && onLoadMore ? (
          <Button variant="ghost" onClick={onLoadMore} loading={loading}>
            Load older
          </Button>
        ) : null}
        {loading && threads.length === 0 ? (
          <Empty>
            <Typography variant="pi">Loading conversations…</Typography>
          </Empty>
        ) : null}
      </List>
    </Aside>
  );
};

export default ThreadSidebar;
