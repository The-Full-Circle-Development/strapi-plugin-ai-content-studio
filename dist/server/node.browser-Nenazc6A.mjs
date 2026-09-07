import { aE as AnthropicError } from "./index-D5zw8c7m.mjs";
import { aF, aG } from "./index-D5zw8c7m.mjs";
function nodeOnly(name) {
  throw new AnthropicError(`${name} requires Node.js or a Node-compatible runtime`);
}
const MEMORY_FLUSH_TIMEOUT_MS = 3e4;
const MARKER_PATH = ".anthropic-memory-store";
class SessionMemoryError extends AnthropicError {
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
class BashTimeoutError extends AnthropicError {
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
export {
  BashSession,
  BashTimeoutError,
  aF as DEFAULT_MEMORY_SYNC_INTERVAL_MS,
  MARKER_PATH,
  MEMORY_FLUSH_TIMEOUT_MS,
  aG as MIN_MEMORY_SYNC_INTERVAL_MS,
  SessionMemoryError,
  SessionMemoryStores,
  betaAgentToolset20260401,
  betaBashTool,
  betaEditTool,
  betaGlobTool,
  betaGrepTool,
  betaReadTool,
  betaWriteTool,
  extractSkillArchive,
  resolvePath,
  resolveSkillVersion,
  setupSkills
};
