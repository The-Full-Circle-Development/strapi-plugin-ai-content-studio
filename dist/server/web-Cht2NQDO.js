"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const index = require("./index-B9qZv_2A.js");
const POLLUTION_KEYS = /* @__PURE__ */ new Set([
  "__proto__",
  "constructor",
  "prototype"
]);
function assertSafeStorageKey(field, value, options = {}) {
  const { allowEmpty = false } = options;
  if (typeof value !== "string") {
    const observed = value === null ? "null" : value === void 0 ? "undefined" : Array.isArray(value) ? "array" : typeof value;
    throw new Error(`Invalid configurable value for key "${field}": expected a string identifier (got ${observed}). This guard protects MemorySaver from prototype pollution.`);
  }
  if (!allowEmpty && value === "") throw new Error(`Invalid configurable value for key "${field}": empty string is not permitted as an in-memory storage key.`);
  if (POLLUTION_KEYS.has(value)) throw new Error(`Invalid configurable value for key "${field}": value "${value}" is reserved (would mutate Object.prototype). This guard protects MemorySaver from prototype pollution.`);
}
function _generateKey(threadId, checkpointNamespace, checkpointId) {
  return JSON.stringify([
    threadId,
    checkpointNamespace,
    checkpointId
  ]);
}
function _parseKey(key) {
  const [threadId, checkpointNamespace, checkpointId] = JSON.parse(key);
  return {
    threadId,
    checkpointNamespace,
    checkpointId
  };
}
var MemorySaver = class extends index.BaseCheckpointSaver {
  storage = /* @__PURE__ */ Object.create(null);
  writes = /* @__PURE__ */ Object.create(null);
  constructor(serde) {
    super(serde);
  }
  /** @internal */
  async _migratePendingSends(mutableCheckpoint, threadId, checkpointNs, parentCheckpointId) {
    const deseriablizableCheckpoint = mutableCheckpoint;
    const parentKey = _generateKey(threadId, checkpointNs, parentCheckpointId);
    const pendingSends = await Promise.all(Object.values(this.writes[parentKey] ?? {}).filter(([_taskId, channel]) => channel === index.TASKS).map(async ([_taskId, _channel, writes]) => await this.serde.loadsTyped("json", writes)));
    deseriablizableCheckpoint.channel_values ??= {};
    deseriablizableCheckpoint.channel_values[index.TASKS] = pendingSends;
    deseriablizableCheckpoint.channel_versions ??= {};
    deseriablizableCheckpoint.channel_versions[index.TASKS] = Object.keys(deseriablizableCheckpoint.channel_versions).length > 0 ? index.maxChannelVersion(...Object.values(deseriablizableCheckpoint.channel_versions)) : this.getNextVersion(void 0);
  }
  async getTuple(config) {
    const thread_id = config.configurable?.thread_id;
    const checkpoint_ns = config.configurable?.checkpoint_ns ?? "";
    let checkpoint_id = index.getCheckpointId(config);
    if (thread_id !== void 0) assertSafeStorageKey("thread_id", thread_id);
    assertSafeStorageKey("checkpoint_ns", checkpoint_ns, { allowEmpty: true });
    if (checkpoint_id) assertSafeStorageKey("checkpoint_id", checkpoint_id);
    if (checkpoint_id) {
      const saved = this.storage[thread_id]?.[checkpoint_ns]?.[checkpoint_id];
      if (saved !== void 0) {
        const [checkpoint, metadata, parentCheckpointId] = saved;
        const key = _generateKey(thread_id, checkpoint_ns, checkpoint_id);
        const deserializedCheckpoint = await this.serde.loadsTyped("json", checkpoint);
        if (deserializedCheckpoint.v < 4 && parentCheckpointId !== void 0) await this._migratePendingSends(deserializedCheckpoint, thread_id, checkpoint_ns, parentCheckpointId);
        const pendingWrites = await Promise.all(Object.values(this.writes[key] || {}).map(async ([taskId, channel, value]) => {
          return [
            taskId,
            channel,
            await this.serde.loadsTyped("json", value)
          ];
        }));
        const checkpointTuple = {
          config,
          checkpoint: deserializedCheckpoint,
          metadata: await this.serde.loadsTyped("json", metadata),
          pendingWrites
        };
        if (parentCheckpointId !== void 0) checkpointTuple.parentConfig = { configurable: {
          thread_id,
          checkpoint_ns,
          checkpoint_id: parentCheckpointId
        } };
        return checkpointTuple;
      }
    } else {
      const checkpoints = this.storage[thread_id]?.[checkpoint_ns];
      if (checkpoints !== void 0) {
        checkpoint_id = Object.keys(checkpoints).sort((a, b) => b.localeCompare(a))[0];
        const [checkpoint, metadata, parentCheckpointId] = checkpoints[checkpoint_id];
        const key = _generateKey(thread_id, checkpoint_ns, checkpoint_id);
        const deserializedCheckpoint = await this.serde.loadsTyped("json", checkpoint);
        if (deserializedCheckpoint.v < 4 && parentCheckpointId !== void 0) await this._migratePendingSends(deserializedCheckpoint, thread_id, checkpoint_ns, parentCheckpointId);
        const pendingWrites = await Promise.all(Object.values(this.writes[key] || {}).map(async ([taskId, channel, value]) => {
          return [
            taskId,
            channel,
            await this.serde.loadsTyped("json", value)
          ];
        }));
        const checkpointTuple = {
          config: { configurable: {
            thread_id,
            checkpoint_id,
            checkpoint_ns
          } },
          checkpoint: deserializedCheckpoint,
          metadata: await this.serde.loadsTyped("json", metadata),
          pendingWrites
        };
        if (parentCheckpointId !== void 0) checkpointTuple.parentConfig = { configurable: {
          thread_id,
          checkpoint_ns,
          checkpoint_id: parentCheckpointId
        } };
        return checkpointTuple;
      }
    }
  }
  async *list(config, options) {
    let { before, limit, filter } = options ?? {};
    if (config.configurable?.thread_id !== void 0) assertSafeStorageKey("thread_id", config.configurable.thread_id);
    if (config.configurable?.checkpoint_ns !== void 0) assertSafeStorageKey("checkpoint_ns", config.configurable.checkpoint_ns, { allowEmpty: true });
    if (config.configurable?.checkpoint_id) assertSafeStorageKey("checkpoint_id", config.configurable.checkpoint_id);
    if (before?.configurable?.checkpoint_id) assertSafeStorageKey("checkpoint_id", before.configurable.checkpoint_id);
    const threadIds = config.configurable?.thread_id ? [config.configurable?.thread_id] : Object.keys(this.storage);
    const configCheckpointNamespace = config.configurable?.checkpoint_ns;
    const configCheckpointId = config.configurable?.checkpoint_id;
    for (const threadId of threadIds) for (const checkpointNamespace of Object.keys(this.storage[threadId] ?? {})) {
      if (configCheckpointNamespace !== void 0 && checkpointNamespace !== configCheckpointNamespace) continue;
      const checkpoints = this.storage[threadId]?.[checkpointNamespace] ?? {};
      const sortedCheckpoints = Object.entries(checkpoints).sort((a, b) => b[0].localeCompare(a[0]));
      for (const [checkpointId, [checkpoint, metadataStr, parentCheckpointId]] of sortedCheckpoints) {
        if (configCheckpointId && checkpointId !== configCheckpointId) continue;
        if (before && before.configurable?.checkpoint_id && checkpointId >= before.configurable.checkpoint_id) continue;
        const metadata = await this.serde.loadsTyped("json", metadataStr);
        if (filter && !Object.entries(filter).every(([key2, value]) => metadata[key2] === value)) continue;
        if (limit !== void 0) {
          if (limit <= 0) break;
          limit -= 1;
        }
        const key = _generateKey(threadId, checkpointNamespace, checkpointId);
        const writes = Object.values(this.writes[key] || {});
        const pendingWrites = await Promise.all(writes.map(async ([taskId, channel, value]) => {
          return [
            taskId,
            channel,
            await this.serde.loadsTyped("json", value)
          ];
        }));
        const deserializedCheckpoint = await this.serde.loadsTyped("json", checkpoint);
        if (deserializedCheckpoint.v < 4 && parentCheckpointId !== void 0) await this._migratePendingSends(deserializedCheckpoint, threadId, checkpointNamespace, parentCheckpointId);
        const checkpointTuple = {
          config: { configurable: {
            thread_id: threadId,
            checkpoint_ns: checkpointNamespace,
            checkpoint_id: checkpointId
          } },
          checkpoint: deserializedCheckpoint,
          metadata,
          pendingWrites
        };
        if (parentCheckpointId !== void 0) checkpointTuple.parentConfig = { configurable: {
          thread_id: threadId,
          checkpoint_ns: checkpointNamespace,
          checkpoint_id: parentCheckpointId
        } };
        yield checkpointTuple;
      }
    }
  }
  async put(config, checkpoint, metadata) {
    const preparedCheckpoint = index.copyCheckpoint(checkpoint);
    const threadId = config.configurable?.thread_id;
    const checkpointNamespace = config.configurable?.checkpoint_ns ?? "";
    if (threadId === void 0) throw new Error('Failed to put checkpoint. The passed RunnableConfig is missing a required "thread_id" field in its "configurable" property. When using a checkpointer, you must pass a "thread_id" so the checkpointer knows which conversation thread to persist state for. Example: graph.stream(input, { configurable: { thread_id: "my-thread-id" } })');
    assertSafeStorageKey("thread_id", threadId);
    assertSafeStorageKey("checkpoint_ns", checkpointNamespace, { allowEmpty: true });
    assertSafeStorageKey("checkpoint_id", checkpoint.id);
    if (!this.storage[threadId]) this.storage[threadId] = /* @__PURE__ */ Object.create(null);
    if (!this.storage[threadId][checkpointNamespace]) this.storage[threadId][checkpointNamespace] = /* @__PURE__ */ Object.create(null);
    const [[, serializedCheckpoint], [, serializedMetadata]] = await Promise.all([this.serde.dumpsTyped(preparedCheckpoint), this.serde.dumpsTyped(metadata)]);
    this.storage[threadId][checkpointNamespace][checkpoint.id] = [
      serializedCheckpoint,
      serializedMetadata,
      config.configurable?.checkpoint_id
    ];
    return { configurable: {
      thread_id: threadId,
      checkpoint_ns: checkpointNamespace,
      checkpoint_id: checkpoint.id
    } };
  }
  async putWrites(config, writes, taskId) {
    const threadId = config.configurable?.thread_id;
    const checkpointNamespace = config.configurable?.checkpoint_ns;
    const checkpointId = config.configurable?.checkpoint_id;
    if (threadId === void 0) throw new Error('Failed to put writes. The passed RunnableConfig is missing a required "thread_id" field in its "configurable" property. When using a checkpointer, you must pass a "thread_id" so the checkpointer knows which conversation thread to persist state for. Example: graph.stream(input, { configurable: { thread_id: "my-thread-id" } })');
    if (checkpointId === void 0) throw new Error(`Failed to put writes. The passed RunnableConfig is missing a required "checkpoint_id" field in its "configurable" property.`);
    assertSafeStorageKey("thread_id", threadId);
    assertSafeStorageKey("checkpoint_ns", checkpointNamespace, { allowEmpty: true });
    assertSafeStorageKey("checkpoint_id", checkpointId);
    assertSafeStorageKey("task_id", taskId);
    const outerKey = _generateKey(threadId, checkpointNamespace, checkpointId);
    const outerWrites_ = this.writes[outerKey];
    if (this.writes[outerKey] === void 0) this.writes[outerKey] = /* @__PURE__ */ Object.create(null);
    await Promise.all(writes.map(async ([channel, value], idx) => {
      const [, serializedValue] = await this.serde.dumpsTyped(value);
      const innerKey = [taskId, index.WRITES_IDX_MAP[channel] || idx];
      const innerKeyStr = `${innerKey[0]},${innerKey[1]}`;
      if (innerKey[1] >= 0 && outerWrites_ && innerKeyStr in outerWrites_) return;
      this.writes[outerKey][innerKeyStr] = [
        taskId,
        channel,
        serializedValue
      ];
    }));
  }
  async deleteThread(threadId) {
    assertSafeStorageKey("thread_id", threadId);
    delete this.storage[threadId];
    for (const key of Object.keys(this.writes)) if (_parseKey(key).threadId === threadId) delete this.writes[key];
  }
  /**
  * Override: walk the parent chain ONCE for all requested channels using
  * direct storage access.
  *
  * Each channel terminates independently at the nearest ancestor whose
  * stored `channel_values[ch]` is populated. Other channels keep walking
  * until they find their own terminator or hit the root.
  *
  * The seed value (whether a `DeltaSnapshot` or a plain pre-delta migration
  * blob) is the value AT that ancestor, prior to its own pending writes that
  * produce the child. Those on-path writes — including the ones stored on the
  * terminating ancestor — are always collected and replayed on top of the
  * seed, so a thread migrated from a pre-delta channel does not drop the
  * writes saved under the migration boundary checkpoint.
  *
  * @remarks Beta. See {@link BaseCheckpointSaver.getDeltaChannelHistory}.
  */
  async getDeltaChannelHistory(options) {
    const { config, channels } = options;
    if (channels.length === 0) return {};
    const threadId = config.configurable?.thread_id;
    const checkpointNs = config.configurable?.checkpoint_ns ?? "";
    const checkpointId = index.getCheckpointId(config);
    if (threadId !== void 0) assertSafeStorageKey("thread_id", threadId);
    assertSafeStorageKey("checkpoint_ns", checkpointNs, { allowEmpty: true });
    const nsStorage = this.storage[threadId]?.[checkpointNs] ?? {};
    const chain = [];
    let current = (checkpointId ? nsStorage[checkpointId] : void 0)?.[2];
    while (current !== void 0) {
      const entry = nsStorage[current];
      if (entry === void 0) break;
      chain.push(current);
      current = entry[2];
    }
    const collectedByCh = {};
    const seedByCh = {};
    const remaining = new Set(channels);
    for (const ch of channels) collectedByCh[ch] = [];
    for (const cpId of chain) {
      if (remaining.size === 0) break;
      const entry = nsStorage[cpId];
      const ckpt = entry !== void 0 ? await this.serde.loadsTyped("json", entry[0]) : void 0;
      const blobValueByCh = {};
      const terminatedHere = /* @__PURE__ */ new Set();
      if (ckpt !== void 0) {
        for (const ch of remaining) if (Object.prototype.hasOwnProperty.call(ckpt.channel_values, ch) && ckpt.channel_values[ch] !== void 0) {
          blobValueByCh[ch] = ckpt.channel_values[ch];
          terminatedHere.add(ch);
        }
      }
      const stepWritesKey = _generateKey(threadId, checkpointNs, cpId);
      const stepWrites = Object.entries(this.writes[stepWritesKey] ?? {});
      stepWrites.sort(([a], [b]) => {
        const [aTask, aIdx] = a.split(",");
        const [bTask, bIdx] = b.split(",");
        if (aTask !== bTask) return aTask < bTask ? 1 : -1;
        return Number(bIdx) - Number(aIdx);
      });
      for (const [, [tid, ch, serialized]] of stepWrites) {
        if (!remaining.has(ch)) continue;
        collectedByCh[ch].push([
          tid,
          ch,
          await this.serde.loadsTyped("json", serialized)
        ]);
      }
      for (const ch of terminatedHere) {
        seedByCh[ch] = blobValueByCh[ch];
        remaining.delete(ch);
      }
    }
    const result = {};
    for (const ch of channels) {
      const entryH = { writes: collectedByCh[ch].slice().reverse() };
      if (Object.prototype.hasOwnProperty.call(seedByCh, ch)) entryH.seed = seedByCh[ch];
      result[ch] = entryH;
    }
    return result;
  }
};
function tokenizePath(path) {
  if (!path) return [];
  const tokens = [];
  let current = [];
  let i = 0;
  while (i < path.length) {
    const char = path[i];
    if (char === "[") {
      if (current.length) {
        tokens.push(current.join(""));
        current = [];
      }
      let bracketCount = 1;
      const indexChars = ["["];
      i += 1;
      while (i < path.length && bracketCount > 0) {
        if (path[i] === "[") bracketCount += 1;
        else if (path[i] === "]") bracketCount -= 1;
        indexChars.push(path[i]);
        i += 1;
      }
      tokens.push(indexChars.join(""));
      continue;
    } else if (char === "{") {
      if (current.length) {
        tokens.push(current.join(""));
        current = [];
      }
      let braceCount = 1;
      const fieldChars = ["{"];
      i += 1;
      while (i < path.length && braceCount > 0) {
        if (path[i] === "{") braceCount += 1;
        else if (path[i] === "}") braceCount -= 1;
        fieldChars.push(path[i]);
        i += 1;
      }
      tokens.push(fieldChars.join(""));
      continue;
    } else if (char === ".") {
      if (current.length) {
        tokens.push(current.join(""));
        current = [];
      }
    } else current.push(char);
    i += 1;
  }
  if (current.length) tokens.push(current.join(""));
  return tokens;
}
function isFilterOperators(obj) {
  return typeof obj === "object" && obj !== null && Object.keys(obj).every((key) => key === "$eq" || key === "$ne" || key === "$gt" || key === "$gte" || key === "$lt" || key === "$lte" || key === "$in" || key === "$nin");
}
function compareValues(itemValue, filterValue) {
  if (isFilterOperators(filterValue)) return Object.keys(filterValue).filter((k) => k.startsWith("$")).every((op) => {
    const value = filterValue[op];
    switch (op) {
      case "$eq":
        return itemValue === value;
      case "$ne":
        return itemValue !== value;
      case "$gt":
        return Number(itemValue) > Number(value);
      case "$gte":
        return Number(itemValue) >= Number(value);
      case "$lt":
        return Number(itemValue) < Number(value);
      case "$lte":
        return Number(itemValue) <= Number(value);
      case "$in":
        return Array.isArray(value) ? value.includes(itemValue) : false;
      case "$nin":
        return Array.isArray(value) ? !value.includes(itemValue) : true;
      default:
        return false;
    }
  });
  return itemValue === filterValue;
}
function getTextAtPath(obj, path) {
  if (!path || path === "$") return [JSON.stringify(obj, null, 2)];
  const tokens = Array.isArray(path) ? path : tokenizePath(path);
  function extractFromObj(obj2, tokens2, pos) {
    if (pos >= tokens2.length) {
      if (typeof obj2 === "string" || typeof obj2 === "number" || typeof obj2 === "boolean") return [String(obj2)];
      if (obj2 === null || obj2 === void 0) return [];
      if (Array.isArray(obj2) || typeof obj2 === "object") return [JSON.stringify(obj2, null, 2)];
      return [];
    }
    const token = tokens2[pos];
    const results = [];
    if (pos === 0 && token === "$") results.push(JSON.stringify(obj2, null, 2));
    if (token.startsWith("[") && token.endsWith("]")) {
      if (!Array.isArray(obj2)) return [];
      const index2 = token.slice(1, -1);
      if (index2 === "*") for (const item of obj2) results.push(...extractFromObj(item, tokens2, pos + 1));
      else try {
        let idx = parseInt(index2, 10);
        if (idx < 0) idx = obj2.length + idx;
        if (idx >= 0 && idx < obj2.length) results.push(...extractFromObj(obj2[idx], tokens2, pos + 1));
      } catch {
        return [];
      }
    } else if (token.startsWith("{") && token.endsWith("}")) {
      if (typeof obj2 !== "object" || obj2 === null) return [];
      const fields = token.slice(1, -1).split(",").map((f) => f.trim());
      for (const field of fields) {
        const nestedTokens = tokenizePath(field);
        if (nestedTokens.length) {
          let currentObj = obj2;
          for (const nestedToken of nestedTokens) if (currentObj && typeof currentObj === "object" && nestedToken in currentObj) currentObj = currentObj[nestedToken];
          else {
            currentObj = void 0;
            break;
          }
          if (currentObj !== void 0) {
            if (typeof currentObj === "string" || typeof currentObj === "number" || typeof currentObj === "boolean") results.push(String(currentObj));
            else if (Array.isArray(currentObj) || typeof currentObj === "object") results.push(JSON.stringify(currentObj, null, 2));
          }
        }
      }
    } else if (token === "*") {
      if (Array.isArray(obj2)) for (const item of obj2) results.push(...extractFromObj(item, tokens2, pos + 1));
      else if (typeof obj2 === "object" && obj2 !== null) for (const value of Object.values(obj2)) results.push(...extractFromObj(value, tokens2, pos + 1));
    } else if (typeof obj2 === "object" && obj2 !== null && token in obj2) results.push(...extractFromObj(obj2[token], tokens2, pos + 1));
    return results;
  }
  return extractFromObj(obj, tokens, 0);
}
var InMemoryStore = class extends index.BaseStore {
  data = /* @__PURE__ */ new Map();
  vectors = /* @__PURE__ */ new Map();
  _indexConfig;
  constructor(options) {
    super();
    if (options?.index) this._indexConfig = {
      ...options.index,
      __tokenizedFields: (options.index.fields ?? ["$"]).map((p) => [p, p === "$" ? [p] : tokenizePath(p)])
    };
  }
  async batch(operations) {
    const results = [];
    const putOps = /* @__PURE__ */ new Map();
    const searchOps = /* @__PURE__ */ new Map();
    for (let i = 0; i < operations.length; i += 1) {
      const op = operations[i];
      if ("key" in op && "namespace" in op && !("value" in op)) results.push(this.getOperation(op));
      else if ("namespacePrefix" in op) {
        const candidates = this.filterItems(op);
        searchOps.set(i, [op, candidates]);
        results.push(null);
      } else if ("value" in op) {
        const key = `${op.namespace.join(":")}:${op.key}`;
        putOps.set(key, op);
        results.push(null);
      } else if ("matchConditions" in op) results.push(this.listNamespacesOperation(op));
    }
    if (searchOps.size > 0) if (this._indexConfig?.embeddings) {
      const queries = /* @__PURE__ */ new Set();
      for (const [op] of searchOps.values()) if (op.query) queries.add(op.query);
      const queryEmbeddings = queries.size > 0 ? await Promise.all(Array.from(queries).map((q) => this._indexConfig.embeddings.embedQuery(q))) : [];
      const queryVectors = Object.fromEntries(Array.from(queries).map((q, i) => [q, queryEmbeddings[i]]));
      for (const [i, [op, candidates]] of searchOps.entries()) if (op.query && queryVectors[op.query]) {
        const queryVector = queryVectors[op.query];
        results[i] = this.scoreResults(candidates, queryVector, op.offset ?? 0, op.limit ?? 10);
      } else results[i] = this.paginateResults(candidates.map((item) => ({
        ...item,
        score: void 0
      })), op.offset ?? 0, op.limit ?? 10);
    } else for (const [i, [op, candidates]] of searchOps.entries()) results[i] = this.paginateResults(candidates.map((item) => ({
      ...item,
      score: void 0
    })), op.offset ?? 0, op.limit ?? 10);
    if (putOps.size > 0 && this._indexConfig?.embeddings) {
      const toEmbed = this.extractTexts(Array.from(putOps.values()));
      if (Object.keys(toEmbed).length > 0) {
        const embeddings = await this._indexConfig.embeddings.embedDocuments(Object.keys(toEmbed));
        this.insertVectors(toEmbed, embeddings);
      }
    }
    for (const op of putOps.values()) this.putOperation(op);
    return results;
  }
  getOperation(op) {
    const namespaceKey = op.namespace.join(":");
    return this.data.get(namespaceKey)?.get(op.key) ?? null;
  }
  putOperation(op) {
    const namespaceKey = op.namespace.join(":");
    if (!this.data.has(namespaceKey)) this.data.set(namespaceKey, /* @__PURE__ */ new Map());
    const namespaceMap = this.data.get(namespaceKey);
    if (op.value === null) namespaceMap.delete(op.key);
    else {
      const now = /* @__PURE__ */ new Date();
      if (namespaceMap.has(op.key)) {
        const item = namespaceMap.get(op.key);
        item.value = op.value;
        item.updatedAt = now;
      } else namespaceMap.set(op.key, {
        value: op.value,
        key: op.key,
        namespace: op.namespace,
        createdAt: now,
        updatedAt: now
      });
    }
  }
  listNamespacesOperation(op) {
    let namespaces = Array.from(this.data.keys()).map((ns) => ns.split(":"));
    if (op.matchConditions && op.matchConditions.length > 0) namespaces = namespaces.filter((ns) => op.matchConditions.every((condition) => this.doesMatch(condition, ns)));
    if (op.maxDepth !== void 0) namespaces = Array.from(new Set(namespaces.map((ns) => ns.slice(0, op.maxDepth).join(":")))).map((ns) => ns.split(":"));
    namespaces.sort((a, b) => a.join(":").localeCompare(b.join(":")));
    return namespaces.slice(op.offset ?? 0, (op.offset ?? 0) + (op.limit ?? namespaces.length));
  }
  doesMatch(matchCondition, key) {
    const { matchType, path } = matchCondition;
    if (matchType === "prefix") {
      if (path.length > key.length) return false;
      return path.every((pElem, index2) => {
        const kElem = key[index2];
        return pElem === "*" || kElem === pElem;
      });
    } else if (matchType === "suffix") {
      if (path.length > key.length) return false;
      return path.every((pElem, index2) => {
        const kElem = key[key.length - path.length + index2];
        return pElem === "*" || kElem === pElem;
      });
    }
    throw new Error(`Unsupported match type: ${matchType}`);
  }
  filterItems(op) {
    const candidates = [];
    for (const [namespace, items] of this.data.entries()) if (namespace.startsWith(op.namespacePrefix.join(":"))) candidates.push(...items.values());
    let filteredCandidates = candidates;
    if (op.filter) filteredCandidates = candidates.filter((item) => Object.entries(op.filter).every(([key, value]) => compareValues(item.value[key], value)));
    return filteredCandidates;
  }
  scoreResults(candidates, queryVector, offset = 0, limit = 10) {
    const flatItems = [];
    const flatVectors = [];
    const scoreless = [];
    for (const item of candidates) {
      const vectors = this.getVectors(item);
      if (vectors.length) for (const vector of vectors) {
        flatItems.push(item);
        flatVectors.push(vector);
      }
      else scoreless.push(item);
    }
    const sortedResults = this.cosineSimilarity(queryVector, flatVectors).map((score, i) => [score, flatItems[i]]).sort((a, b) => b[0] - a[0]);
    const seen = /* @__PURE__ */ new Set();
    const kept = [];
    for (const [score, item] of sortedResults) {
      const key = `${item.namespace.join(":")}:${item.key}`;
      if (seen.has(key)) continue;
      const ix = seen.size;
      if (ix >= offset + limit) break;
      if (ix < offset) {
        seen.add(key);
        continue;
      }
      seen.add(key);
      kept.push([score, item]);
    }
    if (scoreless.length && kept.length < limit) for (const item of scoreless.slice(0, limit - kept.length)) {
      const key = `${item.namespace.join(":")}:${item.key}`;
      if (!seen.has(key)) {
        seen.add(key);
        kept.push([void 0, item]);
      }
    }
    return kept.map(([score, item]) => ({
      ...item,
      score
    }));
  }
  paginateResults(results, offset, limit) {
    return results.slice(offset, offset + limit);
  }
  extractTexts(ops) {
    if (!ops.length || !this._indexConfig) return {};
    const toEmbed = {};
    for (const op of ops) if (op.value !== null && op.index !== false) {
      const paths = op.index === null || op.index === void 0 ? this._indexConfig.__tokenizedFields ?? [] : op.index.map((ix) => [ix, tokenizePath(ix)]);
      for (const [path, field] of paths) {
        const texts = getTextAtPath(op.value, field);
        if (texts.length) if (texts.length > 1) texts.forEach((text, i) => {
          if (!toEmbed[text]) toEmbed[text] = [];
          toEmbed[text].push([
            op.namespace,
            op.key,
            `${path}.${i}`
          ]);
        });
        else {
          if (!toEmbed[texts[0]]) toEmbed[texts[0]] = [];
          toEmbed[texts[0]].push([
            op.namespace,
            op.key,
            path
          ]);
        }
      }
    }
    return toEmbed;
  }
  insertVectors(texts, embeddings) {
    for (const [text, metadata] of Object.entries(texts)) {
      const embedding = embeddings.shift();
      if (!embedding) throw new Error(`No embedding found for text: ${text}`);
      for (const [namespace, key, field] of metadata) {
        const namespaceKey = namespace.join(":");
        if (!this.vectors.has(namespaceKey)) this.vectors.set(namespaceKey, /* @__PURE__ */ new Map());
        const namespaceMap = this.vectors.get(namespaceKey);
        if (!namespaceMap.has(key)) namespaceMap.set(key, /* @__PURE__ */ new Map());
        namespaceMap.get(key).set(field, embedding);
      }
    }
  }
  getVectors(item) {
    const namespaceKey = item.namespace.join(":");
    const itemKey = item.key;
    if (!this.vectors.has(namespaceKey)) return [];
    const namespaceMap = this.vectors.get(namespaceKey);
    if (!namespaceMap.has(itemKey)) return [];
    const itemMap = namespaceMap.get(itemKey);
    const vectors = Array.from(itemMap.values());
    if (!vectors.length) return [];
    return vectors;
  }
  cosineSimilarity(X, Y) {
    if (!Y.length) return [];
    const dotProducts = Y.map((vector) => vector.reduce((acc, val, i) => acc + val * X[i], 0));
    const magnitude1 = Math.sqrt(X.reduce((acc, val) => acc + val * val, 0));
    const magnitudes2 = Y.map((vector) => Math.sqrt(vector.reduce((acc, val) => acc + val * val, 0)));
    return dotProducts.map((dot, i) => {
      const magnitude2 = magnitudes2[i];
      return magnitude1 && magnitude2 ? dot / (magnitude1 * magnitude2) : 0;
    });
  }
  get indexConfig() {
    return this._indexConfig;
  }
};
var MessageGraph = class extends index.StateGraph {
  constructor() {
    super({ channels: { __root__: {
      reducer: index.messagesStateReducer,
      default: () => []
    } } });
  }
};
function pushMessage(message, options) {
  const { stateKey: userStateKey, ...userConfig } = options ?? {};
  const config = index.ensureLangGraphConfig(userConfig);
  let stateKey = userStateKey ?? "messages";
  if (userStateKey === null) stateKey = void 0;
  const validMessage = index.coerceMessageLikeToMessage(message);
  if (!validMessage.id) throw new Error("Message ID is required.");
  const callbacks = (() => {
    if (Array.isArray(config.callbacks)) return config.callbacks;
    if (typeof config.callbacks !== "undefined") return config.callbacks.handlers;
    return [];
  })();
  const messagesHandler = callbacks.find((cb) => "name" in cb && cb.name === "StreamMessagesHandler");
  const protocolMessagesHandler = callbacks.find((cb) => "name" in cb && cb.name === "StreamProtocolMessagesHandler");
  if (messagesHandler || protocolMessagesHandler) {
    const metadata = config.metadata ?? {};
    const namespace = (metadata.langgraph_checkpoint_ns ?? "").split("|");
    if (messagesHandler) messagesHandler._emit([namespace, metadata], validMessage, void 0, false);
    else if (protocolMessagesHandler) protocolMessagesHandler.emitFinalMessage([namespace, metadata], validMessage, void 0, false);
  }
  if (stateKey) config.configurable?.__pregel_send?.([[stateKey, validMessage]]);
  return validMessage;
}
function writer(chunk) {
  const config = index.AsyncLocalStorageProviderSingleton.getRunnableConfig();
  if (!config) throw new Error("Called interrupt() outside the context of a graph.");
  const conf = config.configurable;
  if (!conf) throw new Error("No configurable found in config");
  return conf.writer?.(chunk);
}
exports.Annotation = index.Annotation;
exports.AsyncBatchedStore = index.AsyncBatchedStore;
exports.BaseChannel = index.BaseChannel;
exports.BaseCheckpointSaver = index.BaseCheckpointSaver;
exports.BaseLangGraphError = index.BaseLangGraphError;
exports.BaseStore = index.BaseStore;
exports.BinaryOperatorAggregate = index.BinaryOperatorAggregate;
exports.COMMAND_SYMBOL = index.COMMAND_SYMBOL;
exports.ChatModelStreamImpl = index.ChatModelStream;
exports.Command = index.Command;
exports.CommandInstance = index.CommandInstance;
exports.CompiledStateGraph = index.CompiledStateGraph;
exports.DeltaChannel = index.DeltaChannel;
exports.DeltaValue = index.DeltaValue;
exports.END = index.END;
exports.EmptyChannelError = index.EmptyChannelError;
exports.EmptyInputError = index.EmptyInputError;
exports.EventLog = index.StreamChannel;
exports.Graph = index.Graph$1;
exports.GraphBubbleUp = index.GraphBubbleUp;
exports.GraphDrained = index.GraphDrained;
exports.GraphInterrupt = index.GraphInterrupt;
exports.GraphRecursionError = index.GraphRecursionError;
exports.GraphRunStream = index.GraphRunStream;
exports.GraphValueError = index.GraphValueError;
exports.INTERRUPT = index.INTERRUPT;
exports.InvalidUpdateError = index.InvalidUpdateError;
exports.MessagesAnnotation = index.MessagesAnnotation;
exports.MessagesDeltaValue = index.MessagesDeltaValue;
exports.MessagesValue = index.MessagesValue;
exports.MessagesZodMeta = index.MessagesZodMeta;
exports.MessagesZodState = index.MessagesZodState;
exports.MultipleSubgraphsError = index.MultipleSubgraphsError;
exports.NodeError = index.NodeError;
exports.NodeInterrupt = index.NodeInterrupt;
exports.NodeTimeoutError = index.NodeTimeoutError;
exports.Overwrite = index.Overwrite;
exports.ParentCommand = index.ParentCommand;
exports.REMOVE_ALL_MESSAGES = index.REMOVE_ALL_MESSAGES;
exports.ReducedValue = index.ReducedValue;
exports.RemoteException = index.RemoteException;
exports.RunControl = index.RunControl;
exports.START = index.START;
exports.STREAM_EVENTS_V3_MODES = index.STREAM_EVENTS_V3_MODES;
exports.Send = index.Send;
exports.StateGraph = index.StateGraph;
exports.StateGraphInputError = index.StateGraphInputError;
exports.StateSchema = index.StateSchema;
exports.StreamChannel = index.StreamChannel;
exports.SubgraphRunStream = index.SubgraphRunStream;
exports.UnreachableNodeError = index.UnreachableNodeError;
exports.UntrackedValue = index.UntrackedValue;
exports.UntrackedValueChannel = index.UntrackedValueChannel;
exports.addMessages = index.messagesStateReducer;
exports.convertToProtocolEvent = index.convertToProtocolEvent;
exports.copyCheckpoint = index.copyCheckpoint;
exports.createGraphRunStream = index.createGraphRunStream;
exports.createLifecycleTransformer = index.createLifecycleTransformer;
exports.createMessagesTransformer = index.createMessagesTransformer;
exports.createSubgraphDiscoveryTransformer = index.createSubgraphDiscoveryTransformer;
exports.createValuesTransformer = index.createValuesTransformer;
exports.emptyCheckpoint = index.emptyCheckpoint;
exports.entrypoint = index.entrypoint;
exports.filterLifecycleEntries = index.filterLifecycleEntries;
exports.filterSubgraphHandles = index.filterSubgraphHandles;
exports.getConfig = index.getConfig;
exports.getCurrentTaskInput = index.getCurrentTaskInput;
exports.getJsonSchemaFromSchema = index.getJsonSchemaFromSchema;
exports.getPreviousState = index.getPreviousState;
exports.getSchemaDefaultGetter = index.getSchemaDefaultGetter;
exports.getStore = index.getStore;
exports.getSubgraphsSeenSet = index.getSubgraphsSeenSet;
exports.getWriter = index.getWriter;
exports.interrupt = index.interrupt;
exports.isCheckpointEnvelope = index.isCheckpointEnvelope;
exports.isCommand = index.isCommand;
exports.isGraphBubbleUp = index.isGraphBubbleUp;
exports.isGraphDrained = index.isGraphDrained;
exports.isGraphInterrupt = index.isGraphInterrupt;
exports.isInterrupted = index.isInterrupted;
exports.isNativeTransformer = index.isNativeTransformer;
exports.isNodeError = index.isNodeError;
exports.isNodeTimeoutError = index.isNodeTimeoutError;
exports.isParentCommand = index.isParentCommand;
exports.isSerializableSchema = index.isSerializableSchema;
exports.isStandardSchema = index.isStandardSchema;
exports.messagesDeltaReducer = index.messagesDeltaReducer;
exports.messagesStateReducer = index.messagesStateReducer;
exports.task = index.task;
exports.InMemoryStore = InMemoryStore;
exports.MemorySaver = MemorySaver;
exports.MessageGraph = MessageGraph;
exports.pushMessage = pushMessage;
exports.writer = writer;
