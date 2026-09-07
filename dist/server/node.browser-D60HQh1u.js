"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const index = require("./index-B9qZv_2A.js");
function nodeOnly(name) {
  throw new index.AnthropicError(`${name} requires Node.js or a Node-compatible runtime`);
}
const MEMORY_FLUSH_TIMEOUT_MS = 3e4;
const MARKER_PATH = ".anthropic-memory-store";
class SessionMemoryError extends index.AnthropicError {
  constructor(message, cause) {
    super(message);
    this.name = "SessionMemoryError";
    if (cause !== void 0)
      this.cause = cause;
  }
}
class SessionMemoryStores {
  constructor(_client, _opts) {
    nodeOnly("SessionMemoryStores");
  }
  get roots() {
    return nodeOnly("SessionMemoryStores");
  }
  get readOnlyRoots() {
    return nodeOnly("SessionMemoryStores");
  }
  download(_session) {
    return nodeOnly("SessionMemoryStores");
  }
  finish() {
    return nodeOnly("SessionMemoryStores");
  }
  /** @internal */
  syncAll(_final) {
    return nodeOnly("SessionMemoryStores");
  }
  syncIfDue() {
    return nodeOnly("SessionMemoryStores");
  }
  flushWrites(_signal) {
    return nodeOnly("SessionMemoryStores");
  }
  dispose() {
    return nodeOnly("SessionMemoryStores");
  }
}
function setupSkills(_ctx) {
  return nodeOnly("setupSkills");
}
function resolveSkillVersion(_client, _skillId, _version) {
  return nodeOnly("resolveSkillVersion");
}
function extractSkillArchive(_resp, _dest) {
  return nodeOnly("extractSkillArchive");
}
function betaAgentToolset20260401(_ctx) {
  return nodeOnly("betaAgentToolset20260401");
}
function resolvePath(_ctx, _p) {
  return nodeOnly("resolvePath");
}
class BashTimeoutError extends index.AnthropicError {
  constructor(timeoutMs) {
    super(`bash command timed out after ${timeoutMs}ms`);
    this.name = "BashTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}
class BashSession {
  constructor(_dir, _env) {
    nodeOnly("BashSession");
  }
  get closed() {
    return nodeOnly("BashSession");
  }
  exec(_command, _opts = {}) {
    return nodeOnly("BashSession");
  }
  close() {
    nodeOnly("BashSession");
  }
}
function betaBashTool(_ctx) {
  return nodeOnly("betaBashTool");
}
function betaReadTool(_ctx) {
  return nodeOnly("betaReadTool");
}
function betaWriteTool(_ctx) {
  return nodeOnly("betaWriteTool");
}
function betaEditTool(_ctx) {
  return nodeOnly("betaEditTool");
}
function betaGlobTool(_ctx) {
  return nodeOnly("betaGlobTool");
}
function betaGrepTool(_ctx) {
  return nodeOnly("betaGrepTool");
}
exports.DEFAULT_MEMORY_SYNC_INTERVAL_MS = index.DEFAULT_MEMORY_SYNC_INTERVAL_MS;
exports.MIN_MEMORY_SYNC_INTERVAL_MS = index.MIN_MEMORY_SYNC_INTERVAL_MS;
exports.BashSession = BashSession;
exports.BashTimeoutError = BashTimeoutError;
exports.MARKER_PATH = MARKER_PATH;
exports.MEMORY_FLUSH_TIMEOUT_MS = MEMORY_FLUSH_TIMEOUT_MS;
exports.SessionMemoryError = SessionMemoryError;
exports.SessionMemoryStores = SessionMemoryStores;
exports.betaAgentToolset20260401 = betaAgentToolset20260401;
exports.betaBashTool = betaBashTool;
exports.betaEditTool = betaEditTool;
exports.betaGlobTool = betaGlobTool;
exports.betaGrepTool = betaGrepTool;
exports.betaReadTool = betaReadTool;
exports.betaWriteTool = betaWriteTool;
exports.extractSkillArchive = extractSkillArchive;
exports.resolvePath = resolvePath;
exports.resolveSkillVersion = resolveSkillVersion;
exports.setupSkills = setupSkills;
