// SPDX-License-Identifier: MPL-2.0
import { Worker } from 'node:worker_threads'
import type { JsonValue } from '@lumiplug/shared'
import { ToolError } from './config'
/** Run user regex away from Core; a pathological match must not block all tools. */
export function filterResponse(
  value: JsonValue,
  rules: JsonValue,
  signal?: AbortSignal,
): Promise<JsonValue> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ToolError('tool_execution_failed'))
      return
    }
    const worker = new Worker(
      `
      const {parentPort, workerData} = require('node:worker_threads');
      function filter(value, rules) {
        if (typeof rules === 'string') return value !== null && typeof value !== 'object' && new RegExp(rules).test(String(value)) ? value : undefined;
        if (Array.isArray(rules)) return Array.isArray(value) ? value.slice(0,1000).map(v=>filter(v,rules[0])).filter(v=>v!==undefined) : undefined;
        if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
        const out={};
        for (const [key, rule] of Object.entries(rules)) {
          if (!Object.hasOwn(value,key)) continue;
          const v=filter(value[key],rule);
          if(v!==undefined) out[key]=v;
        }
        return out;
      }
      parentPort.postMessage(filter(workerData.value,workerData.rules) ?? null);
    `,
      { eval: true, workerData: { value, rules }, resourceLimits: { maxOldGenerationSizeMb: 32 } },
    )
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      void worker.terminate()
    }
    const abort = () => {
      cleanup()
      reject(new ToolError('tool_execution_failed'))
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new ToolError('tool_response_filter_timeout'))
    }, 500)
    signal?.addEventListener('abort', abort, { once: true })
    worker.once('message', (result) => {
      cleanup()
      resolve(result as JsonValue)
    })
    worker.once('error', () => {
      cleanup()
      reject(new ToolError('tool_config_invalid'))
    })
    worker.once('exit', (code) => {
      if (code !== 0) {
        cleanup()
        reject(new ToolError('tool_execution_failed'))
      }
    })
  })
}
