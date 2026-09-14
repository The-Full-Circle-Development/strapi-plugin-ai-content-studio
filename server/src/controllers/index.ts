import chat from './chat';
import threads from './threads';
import focus from './focus';
import changeSets from './change-sets';
import attachments from './attachments';
import preview from './preview';
import settings from './settings';
import contentBrief from './content-brief';

export default {
  chat,
  threads,
  focus,
  // Route handlers reference this as `change-sets.<handler>`.
  'change-sets': changeSets,
  attachments,
  preview,
  settings,
  // Route handlers reference this as `content-brief.<handler>`.
  'content-brief': contentBrief,
};
