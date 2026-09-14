import crypto from './crypto';
import redact from './redact';
import config from './config';
import registry from './registry';
import agent from './agent';
import prompt from './prompt';
import grounding from './grounding';
import locales from './locales';
import situation from './situation';
import focus from './focus';
import pageReading from './page-reading';
import contentBrief from './content-brief';
import threads from './threads';
import changeSets from './change-sets';
import attachments from './attachments';
import preview from './preview';
import tools from './tools';

export default {
  crypto,
  redact,
  config,
  registry,
  agent,
  prompt,
  grounding,
  locales,
  situation,
  focus,
  // Referenced as service('page-reading').
  'page-reading': pageReading,
  // Referenced as service('content-brief').
  'content-brief': contentBrief,
  threads,
  // Referenced as service('change-sets').
  'change-sets': changeSets,
  attachments,
  preview,
  tools,
};
