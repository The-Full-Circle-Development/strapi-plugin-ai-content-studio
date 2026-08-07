import crypto from './crypto';
import redact from './redact';
import config from './config';
import registry from './registry';
import prompt from './prompt';
import threads from './threads';
import changeSets from './change-sets';
import tools from './tools';

export default {
  crypto,
  redact,
  config,
  registry,
  prompt,
  threads,
  // Referenced as service('change-sets').
  'change-sets': changeSets,
  tools,
};
