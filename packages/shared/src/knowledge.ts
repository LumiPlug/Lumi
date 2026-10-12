// SPDX-License-Identifier: MPL-2.0
import type { AiToolView } from './capability'
import type { JsonSchema } from './json'

export const KNOWLEDGE_VERSION = 3
export const KNOWLEDGE_LIMITS = {
  batchBytes: 256 * 1024,
  operations: 100,
  documents: 1000,
  nodes: 2000,
  edges: 5000,
  revisionBytes: 16 * 1024 * 1024,
  chunkBytes: 32768,
} as const
export interface KnowledgeDocument {
  id: string
  title: string
  parentId: string | null
  order: number
  markdown: string
  citationIds: string[]
}
export interface KnowledgeNode {
  id: string
  label: string
  kind: 'project' | 'module' | 'concept' | 'symbol'
  summary: string
  documentId: string | null
  citationIds: string[]
}
export interface KnowledgeEdge {
  id: string
  from: string
  to: string
  type:
    'contains' | 'explains' | 'references' | 'depends_on' | 'calls' | 'implements' | 'related_to'
  evidenceKind: 'raw' | 'parsed' | 'inferred'
  citationIds: string[]
}
export interface KnowledgeCitation {
  id: string
  path: string
  fileHash: string
  startLine: number
  endLine: number
  quoteHash: string
}
export interface KnowledgeData {
  documents: KnowledgeDocument[]
  nodes: KnowledgeNode[]
  edges: KnowledgeEdge[]
  citations: KnowledgeCitation[]
}
export interface KnowledgeSummary {
  id: string
  name: string
  description: string
  revision: number
  archived: boolean
  projectKey: string
  branch: string
  git: boolean
  commitSha: string | null
  updatedAt: string
  documentCount: number
  nodeCount: number
  build: { id: string; status: string; seq: number; issues: string[] } | null
}
export interface KnowledgeView {
  library: KnowledgeSummary
  revision: number
  commitSha: string | null
  data: KnowledgeData
  versions: {
    revision: number
    commitSha: string | null
    createdAt: string
    documentCount: number
  }[]
}
export interface KnowledgeEvidence {
  path: string
  hash: string
  quoteHash: string
  commitSha: string | null
  startLine: number
  endLine: number
}
export type KnowledgeOperation =
  | { kind: 'document'; value: KnowledgeDocument }
  | { kind: 'node'; value: KnowledgeNode }
  | { kind: 'edge'; value: KnowledgeEdge }
  | { kind: 'citation'; value: KnowledgeCitation }
  | { kind: 'delete'; target: 'document' | 'node' | 'edge' | 'citation'; id: string }

const id: JsonSchema = {
  type: 'string',
  minLength: 1,
  maxLength: 128,
  pattern: '^[a-zA-Z0-9_.:-]+$',
}
const text = (maxLength: number): JsonSchema => ({ type: 'string', maxLength })
const integer: JsonSchema = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER - 1 }
const ids: JsonSchema = { type: 'array', items: id, maxItems: 100, uniqueItems: true }
const object = (
  properties: Record<string, JsonSchema>,
  required = Object.keys(properties),
): JsonSchema => ({ type: 'object', properties, required, additionalProperties: false })
const document = object({
  id,
  title: { ...text(200), minLength: 1 },
  parentId: { anyOf: [id, { type: 'null' }] },
  order: integer,
  markdown: text(262144),
  citationIds: ids,
})
const node = object({
  id,
  label: { ...text(200), minLength: 1 },
  kind: { enum: ['project', 'module', 'concept', 'symbol'], type: 'string' },
  summary: text(2000),
  documentId: { anyOf: [id, { type: 'null' }] },
  citationIds: ids,
})
const edge = object({
  id,
  from: id,
  to: id,
  type: {
    type: 'string',
    enum: ['contains', 'explains', 'references', 'depends_on', 'calls', 'implements', 'related_to'],
  },
  evidenceKind: { type: 'string', enum: ['raw', 'parsed', 'inferred'] },
  citationIds: { ...ids, minItems: 1 },
})
const citation = object({
  id,
  path: { ...text(4096), minLength: 1 },
  fileHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  startLine: { ...integer, minimum: 1 },
  endLine: { ...integer, minimum: 1 },
  quoteHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
})
export const knowledgeDataSchema = object({
  documents: { type: 'array', items: document, maxItems: KNOWLEDGE_LIMITS.documents },
  nodes: { type: 'array', items: node, maxItems: KNOWLEDGE_LIMITS.nodes },
  edges: { type: 'array', items: edge, maxItems: KNOWLEDGE_LIMITS.edges },
  citations: { type: 'array', items: citation, maxItems: 10000 },
})
const operations: JsonSchema = {
  type: 'array',
  minItems: 1,
  maxItems: 100,
  items: {
    oneOf: [
      ...Object.entries({ document, node, edge, citation }).map(([kind, value]) =>
        object({ kind: { const: kind, type: 'string' }, value }),
      ),
      object({
        kind: { const: 'delete', type: 'string' },
        target: { type: 'string', enum: ['document', 'node', 'edge', 'citation'] },
        id,
      }),
    ],
  },
}
const commit: JsonSchema = {
  anyOf: [{ type: 'string', pattern: '^(?:[a-f0-9]{40}|[a-f0-9]{64})$' }, { type: 'null' }],
}
const props = {
  kbId: id,
  projectKey: { ...text(1200), minLength: 1 },
  branch: { ...text(200), minLength: 1 },
  commitSha: commit,
  latestCommitSha: commit,
  buildId: id,
  requestKey: id,
  resumeToken: { ...text(128), minLength: 32 },
  expectedRevision: integer,
  expectedSeq: integer,
  validationId: id,
  batchId: id,
  cursor: text(1000),
  limit: { ...integer, minimum: 1, maximum: 100 },
  revision: { ...integer, minimum: 1 },
  query: { ...text(200), minLength: 1 },
  maxBytes: { ...integer, minimum: 256, maximum: 32768 },
}
function tool(
  name: string,
  description: string,
  keys: (keyof typeof props)[],
  required: string[] = keys,
  extras: Record<string, JsonSchema> = {},
): AiToolView {
  return {
    name: `Lumi.knowledge_${name}`,
    description,
    inputSchema: object(
      { ...Object.fromEntries(keys.map((key) => [key, props[key]])), ...extras },
      required,
    ),
    outputSchema: { type: 'object', additionalProperties: true },
  }
}
export const KNOWLEDGE_TOOLS: AiToolView[] = [
  tool('get_contract', '先读取知识库工作流、数据 Schema、配额与证据规则。', []),
  tool(
    'list',
    '按项目标识和分支查找未归档知识分组。每组独立维护知识版本。',
    ['projectKey', 'branch', 'query', 'cursor', 'limit'],
    [],
  ),
  tool(
    'create',
    '创建或定位项目＋分支知识分组，不读取项目文件。无 Git 默认 main；Git 项目必须提交实际分支名。',
    ['projectKey', 'branch'],
    ['projectKey', 'name', 'git'],
    {
      name: { ...text(120), minLength: 1 },
      description: text(500),
      git: { type: 'boolean' },
    },
  ),
  tool(
    'compare',
    '将外部 AI 提交的当前分支最新 commit SHA 与已发布知识的 commit SHA 对比；不访问 Git 或源码、不自动生成知识。无 Git 返回 no_git。',
    ['kbId', 'latestCommitSha'],
  ),
  tool('prepare_build', '生成一次性构建凭证；立即妥善保存 resumeToken，Lumi 不恢复明文。', [
    'kbId',
  ]),
  tool(
    'begin_build',
    '开始或恢复构建。增量继承旧内容，删除必须显式提交；同库只有一个写入者。',
    ['kbId', 'commitSha', 'expectedRevision', 'requestKey', 'resumeToken'],
    ['kbId', 'commitSha', 'expectedRevision', 'requestKey', 'resumeToken', 'mode'],
    { mode: { type: 'string', enum: ['full', 'incremental'] } },
  ),
  tool(
    'write_batch',
    '提交严格 Schema 批次；同 batchId 和同内容重试幂等，expectedSeq 防止乱序。',
    ['buildId', 'resumeToken', 'batchId', 'expectedSeq'],
    ['buildId', 'resumeToken', 'batchId', 'expectedSeq', 'operations'],
    { operations },
  ),
  tool(
    'get_build',
    '查询持久状态、已确认批次和校验结果；凭证不会返回。',
    ['buildId', 'resumeToken'],
    ['buildId'],
  ),
  tool(
    'validate_build',
    '校验目录、图谱、引用结构，不读取原文、不证明引用真实性或 AI 语义正确。返回 validationId。',
    ['buildId', 'resumeToken', 'expectedSeq'],
  ),
  tool('publish_build', '发布校验通过的精确批次，原子切换版本；必须提供当前 expectedRevision。', [
    'buildId',
    'resumeToken',
    'expectedRevision',
    'expectedSeq',
    'latestCommitSha',
    'validationId',
    'requestKey',
  ]),
  tool('cancel_build', '关闭构建写入权限，不终止外部模型运行。', [
    'buildId',
    'resumeToken',
    'requestKey',
  ]),
  tool(
    'read',
    '读取固定发布版本的目录、文档、节点、证据或版本摘要。',
    ['kbId', 'revision', 'cursor', 'maxBytes'],
    ['kbId', 'target'],
    {
      target: {
        oneOf: [
          object({ kind: { const: 'outline', type: 'string' } }),
          object({ kind: { const: 'document', type: 'string' }, documentId: id }),
          object({ kind: { const: 'node', type: 'string' }, nodeId: id }),
          object({ kind: { const: 'evidence', type: 'string' }, citationId: id }),
          object({ kind: { const: 'version_summary', type: 'string' } }),
        ],
      },
    },
  ),
  tool(
    'search',
    '检索固定发布版本的文档和节点，中文及代码关键词本地检索，无云端向量服务。',
    ['kbId', 'revision', 'query', 'cursor', 'limit'],
    ['kbId', 'query'],
  ),
  tool(
    'graph',
    '读取有上限的概览或节点邻域，depth 最大2；truncated 表示未返回完整图。',
    ['kbId', 'revision'],
    ['kbId'],
    {
      scope: { type: 'string', enum: ['overview', 'neighborhood'] },
      nodeId: id,
      depth: { ...integer, maximum: 2 },
      nodeLimit: { ...integer, minimum: 1, maximum: 150 },
      edgeLimit: { ...integer, minimum: 1, maximum: 300 },
    },
  ),
]
