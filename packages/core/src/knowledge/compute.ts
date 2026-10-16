// SPDX-License-Identifier: MPL-2.0
import { Worker } from 'node:worker_threads'
import type { KnowledgeData } from '@lumiplug/shared'
export type KnowledgeIndexRow = ['document' | 'node', string, string, string]
export interface KnowledgeComputation {
  issues: string[]
  rows: KnowledgeIndexRow[]
  serialized: string
}
export function knowledgeTokens(value: string): string {
  const words = value.toLowerCase().match(/[a-z0-9_]+|[\p{Script=Han}]+/gu) ?? []
  return words
    .flatMap((word) =>
      /\p{Script=Han}/u.test(word)
        ? [
            ...word,
            ...Array.from({ length: Math.max(0, word.length - 1) }, (_, i) => word.slice(i, i + 2)),
          ]
        : [word, ...word.split('_')],
    )
    .join(' ')
}

/** Self-contained so both normal Node and bundled SEA can create the worker without a script file. */
export function computeKnowledge(data: KnowledgeData, index: boolean): KnowledgeComputation {
  const issues: string[] = []
  if (!data.documents.length || !data.nodes.length) issues.push('empty_knowledge')
  const documents = new Map(data.documents.map((document) => [document.id, document]))
  const nodes = new Map(data.nodes.map((node) => [node.id, node]))
  const citations = new Map(data.citations.map((citation) => [citation.id, citation]))
  for (const [kind, items] of Object.entries(data))
    if (new Set(items.map((item: { id: string }) => item.id)).size !== items.length)
      issues.push(`duplicate_${kind}`)
  for (const document of data.documents) {
    const seen = new Set([document.id])
    let parent = document.parentId
    while (parent) {
      if (seen.has(parent)) {
        issues.push(`outline_cycle:${document.id}`)
        break
      }
      seen.add(parent)
      const next = documents.get(parent)
      if (!next) {
        issues.push(`missing_parent:${document.id}`)
        break
      }
      parent = next.parentId
    }
  }
  for (const node of data.nodes)
    if (node.documentId && !documents.has(node.documentId))
      issues.push(`missing_document:${node.id}`)
  for (const edge of data.edges)
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) issues.push(`missing_endpoint:${edge.id}`)
  for (const entity of [...data.documents, ...data.nodes, ...data.edges])
    for (const id of entity.citationIds)
      if (!citations.has(id)) issues.push(`missing_citation:${entity.id}`)
  for (const entity of [...data.documents, ...data.nodes])
    if (!entity.citationIds.length) issues.push(`ungrounded_content:${entity.id}`)
  for (const citation of data.citations) {
    if (
      citation.startLine > citation.endLine ||
      !citation.path ||
      citation.path.includes('\\') ||
      citation.path.includes('\0') ||
      citation.path
        .split('/')
        .some((part) => !part || part === '.' || part === '..' || part.includes(':'))
    )
      issues.push(`invalid_evidence:${citation.id}`)
  }
  const rows: KnowledgeIndexRow[] = index
    ? [
        ...data.documents.map((doc): KnowledgeIndexRow => [
          'document',
          doc.id,
          doc.title,
          knowledgeTokens(`${doc.title}\n${doc.markdown}`),
        ]),
        ...data.nodes.map((node): KnowledgeIndexRow => [
          'node',
          node.id,
          node.label,
          knowledgeTokens(`${node.label}\n${node.summary}`),
        ]),
      ]
    : []
  return { issues: issues.slice(0, 100), rows, serialized: index ? JSON.stringify(data) : '' }
}

export class KnowledgeComputer {
  private active = 0
  private readonly waiting: (() => void)[] = []
  private readonly jobs = new Set<Promise<KnowledgeComputation>>()
  run(data: KnowledgeData, index = false): Promise<KnowledgeComputation> {
    if (this.jobs.size >= 18) return Promise.reject(new Error('knowledge_build_busy'))
    const job = new Promise<KnowledgeComputation>((resolve, reject) => {
      const start = () => {
        this.active++
        let worker: Worker
        let timer: ReturnType<typeof setTimeout> | undefined
        let settled = false
        const finish = (error: Error | null, result?: KnowledgeComputation) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          const terminated = worker ? worker.terminate() : Promise.resolve()
          void terminated
            .catch(() => {})
            .then(() => {
              this.active--
              this.waiting.shift()?.()
              if (error) reject(error)
              else resolve(result!)
            })
        }
        try {
          worker = new Worker(
            `
            const { parentPort, workerData } = require('node:worker_threads');
            const knowledgeTokens = ${knowledgeTokens.toString()};
            const compute = ${computeKnowledge.toString()};
            parentPort.postMessage(compute(workerData.data, workerData.index));
          `,
            {
              eval: true,
              workerData: { data, index },
              resourceLimits: { maxOldGenerationSizeMb: 256 },
            },
          )
          worker.once('message', (result: KnowledgeComputation) => finish(null, result))
          worker.once('error', (error) => finish(error))
          worker.once('exit', () => finish(new Error('knowledge_operation_failed')))
          timer = setTimeout(() => finish(new Error('knowledge_operation_failed')), 30_000)
        } catch (error) {
          finish(error as Error)
        }
      }
      if (this.active < 2) start()
      else this.waiting.push(start)
    })
    this.jobs.add(job)
    void job.finally(() => this.jobs.delete(job)).catch(() => {})
    return job
  }
  async drain() {
    await Promise.allSettled([...this.jobs])
  }
}
