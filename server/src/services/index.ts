import crypto from './crypto';
import redact from './redact';
import config from './config';
import registry from './registry';
import prompt from './prompt';
import threads from './threads';
import changeSets from './change-sets';
import attachments from './attachments';
import preview from './preview';
import auditQa from './audit-qa';
import auditSecurity from './audit-security';
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
  attachments,
  preview,
  // Referenced as service('audit-qa') / service('audit-security').
  'audit-qa': auditQa,
  'audit-security': auditSecurity,
  tools,
};
