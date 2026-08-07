import chatThreadSchema from './chat-thread/schema.json';
import chatMessageSchema from './chat-message/schema.json';
import changeSetSchema from './change-set/schema.json';
import previewSessionSchema from './preview-session/schema.json';

/**
 * Hidden plugin content types (R3). All four are invisible to the Content Manager and the
 * Content-Type Builder and have draft & publish OFF.
 *
 * Hiding them is not cosmetic: it keeps the generic content-manager RBAC from becoming a second,
 * weaker door onto other users' conversations. The ONLY reader is this plugin's own owner-scoped
 * `threads` service, which always filters by `ctx.state.user.id`.
 *
 * They sync on boot, so consumers need no migration step.
 */
export default {
  'chat-thread': { schema: chatThreadSchema },
  'chat-message': { schema: chatMessageSchema },
  'change-set': { schema: changeSetSchema },
  'preview-session': { schema: previewSessionSchema },
};

/** Fully-qualified uids, so services never hand-assemble them. */
export const UID = {
  thread: 'plugin::ai-content-studio.chat-thread',
  message: 'plugin::ai-content-studio.chat-message',
  changeSet: 'plugin::ai-content-studio.change-set',
  previewSession: 'plugin::ai-content-studio.preview-session',
} as const;
