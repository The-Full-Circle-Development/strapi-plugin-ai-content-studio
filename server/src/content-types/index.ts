import chatThreadSchema from './chat-thread/schema.json';
import chatMessageSchema from './chat-message/schema.json';
import changeSetSchema from './change-set/schema.json';
import previewSessionSchema from './preview-session/schema.json';
import contentBriefSchema from './content-brief/schema.json';

/**
 * Hidden plugin content types (R3). All five are invisible to the Content Manager and the
 * Content-Type Builder and have draft & publish OFF.
 *
 * Hiding them is not cosmetic: it keeps the generic content-manager RBAC from becoming a second,
 * weaker door onto other users' conversations. The ONLY reader is this plugin's own owner-scoped
 * `threads` service, which always filters by `ctx.state.user.id`.
 *
 * `content-brief` is the one row set here that is deliberately NOT owner-scoped — it is generated
 * once and shared by every account, by design (contracts/content-brief.md §3). It is still hidden,
 * because its only writer is a super-admin-triggered run and its only reader is the `content-brief`
 * service: leaving the table open to generic content-manager RBAC would let any account with a
 * broad enough content grant rewrite what the assistant is told about the project.
 *
 * They sync on boot, so consumers need no migration step.
 */
export default {
  'chat-thread': { schema: chatThreadSchema },
  'chat-message': { schema: chatMessageSchema },
  'change-set': { schema: changeSetSchema },
  'preview-session': { schema: previewSessionSchema },
  'content-brief': { schema: contentBriefSchema },
};

/** Fully-qualified uids, so services never hand-assemble them. */
export const UID = {
  thread: 'plugin::ai-content-studio.chat-thread',
  message: 'plugin::ai-content-studio.chat-message',
  changeSet: 'plugin::ai-content-studio.change-set',
  previewSession: 'plugin::ai-content-studio.preview-session',
  contentBrief: 'plugin::ai-content-studio.content-brief',
} as const;
