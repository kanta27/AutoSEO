// Shared JSDoc typedefs — runtime is plain JS, but these give IDE/intellisense
// the shape of records flowing through the agent system.

/**
 * @typedef {Object} AgentDef
 * @property {string} id
 * @property {string} name
 * @property {"competitor"|"seo"|"content"} type
 * @property {boolean} enabled
 * @property {string} schedule        node-cron expression, e.g. "0 7 * * *"
 * @property {Object} config
 */

/**
 * @typedef {Object} AgentRun
 * @property {string} id
 * @property {string} agentId
 * @property {"running"|"success"|"error"} status
 * @property {string} startedAt       ISO
 * @property {?string} finishedAt
 * @property {?Object} tokenUsage
 * @property {number} costUsd
 * @property {?string} error
 */

/**
 * @typedef {Object} AgentLogEntry
 * @property {string} runId
 * @property {number} step
 * @property {"reasoning"|"tool_call"|"tool_result"} type
 * @property {Object} content
 * @property {string} at
 */

/**
 * @typedef {Object} Proposal
 * @property {string} id
 * @property {string} agentId
 * @property {string} runId
 * @property {string} type
 * @property {string} title
 * @property {string} summary
 * @property {Object} payload
 * @property {"pending"|"approved"|"rejected"|"published"} status
 * @property {string} createdAt
 * @property {?string} decidedAt
 */

/**
 * @typedef {Object} CompetitorTarget
 * @property {string} id
 * @property {string} name
 * @property {string} domain
 * @property {boolean} enabled
 * @property {Object} config
 */

/**
 * @typedef {Object} CompetitorSnapshot
 * @property {string} id
 * @property {string} targetId
 * @property {string} url
 * @property {string} contentHash
 * @property {string} content
 * @property {string} capturedAt
 */

/**
 * @typedef {Object} ToolDef
 * @property {string} name
 * @property {string} [description]
 * @property {Object} [input_schema]
 * @property {Object} [definition]    For server-side tools (e.g. web_search).
 * @property {(input:Object)=>Promise<any>} [execute]   Omit for server-side tools.
 */

export {}; // marker — file is JSDoc-only.
