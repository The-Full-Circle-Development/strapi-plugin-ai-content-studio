import chat from './chat';
import threads from './threads';
import changeSets from './change-sets';
import settings from './settings';

export default {
  chat,
  threads,
  // Route handlers reference this as `change-sets.<handler>`.
  'change-sets': changeSets,
  settings,
};
