// SPDX-License-Identifier: MPL-2.0
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import type { DatabaseSync } from 'node:sqlite'
import { StringDecoder } from 'node:string_decoder'
import type {
  CapabilityDefinition,
  CapabilityTool,
  JsonObject,
  JsonValue,
  ToolTask,
  TaskSource,
  ToolRunOverrides,
} from '@lumiplug/shared'
import {
  ToolError,
  projectOutput,
  record,
  safeUrl,
  terminalDirectory,
  mergeMcpArguments,
} from './config'
import { filterResponse } from './response-filter'
import type { McpConnections } from './mcp'
import {
  systemTerminalEnvironment,
  terminalCommandArguments,
  withoutLumiCredentials,
} from './terminal-environment'
const LIMIT = 64 * 1024
const now = () => new Date().toISOString()
function privateValues(value: JsonValue): string[] {
  if (value === null) return []
  if (Array.isArray(value)) return value.flatMap(privateValues)
  if (typeof value === 'object')
    return Object.entries(value).flatMap(([key, v]) => [key, ...privateValues(v)])
  return [String(value)]
}
function secrets(def: CapabilityDefinition): string[] {
  const s = def.runner.settings
  const fixed =
    s.type === 'http'
      ? Object.values(s.fixedHeaders)
      : [
          ...Object.values(s.environment),
          ...(s.type === 'mcp' ? Object.values(s.headers ?? {}) : []),
        ]
  const values = [
    ...fixed,
    ...def.tools.flatMap((t) =>
      t.fields.filter((f) => !f.aiVisible).flatMap((f) => [f.key, f.binding?.key ?? '']),
    ),
    ...def.tools.flatMap((t) =>
      t.fields.filter((f) => !f.aiVisible).flatMap((f) => privateValues(f.value)),
    ),
  ]
  return [
    ...new Set(
      values
        .filter((v) => v && v !== 'null')
        .flatMap((v) => [v, encodeURIComponent(v), JSON.stringify(v).slice(1, -1)]),
    ),
  ].sort((a, b) => b.length - a.length)
}
function redact(text: string, values: string[]): string {
  let result = text
  for (const value of values) result = result.split(value).join('[已隐藏]')
  return result
}
interface Active {
  task: ToolTask
  def: CapabilityDefinition
  tool: CapabilityTool
  args: JsonObject
  controller: AbortController
  done: Promise<ToolTask>
  transient: boolean
  process?: ChildProcess
  previous: Active[]
}
export class TaskManager {
  private active = new Map<string, Active>()
  private recent = new Map<
    string,
    { name: string; args: JsonObject; version: number; overrides?: ToolRunOverrides }
  >()
  private closing = false
  constructor(
    private readonly db: DatabaseSync,
    private readonly mcp: McpConnections,
  ) {
    for (const task of this.list())
      if (['running', 'stopping'].includes(task.status))
        this.store({
          ...task,
          status: 'interrupted',
          finishedAt: now(),
          error: '应用重启，执行状态无法恢复。',
          cancellationUncertain: task.runnerType !== 'terminal',
        })
  }
  private store(task: ToolTask): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO tool_tasks(id,capability_id,started_at,task_json) VALUES(?,?,?,?)',
      )
      .run(task.id, task.capabilityId, task.startedAt, JSON.stringify(task))
    this.db
      .prepare(
        "DELETE FROM tool_tasks WHERE id IN (SELECT id FROM tool_tasks WHERE json_extract(task_json,'$.status') NOT IN ('running','stopping') ORDER BY started_at DESC LIMIT -1 OFFSET 200)",
      )
      .run()
  }
  list(capabilityId?: string): ToolTask[] {
    const rows = (capabilityId
      ? this.db
          .prepare(
            'SELECT task_json FROM tool_tasks WHERE capability_id=? ORDER BY started_at DESC LIMIT 220',
          )
          .all(capabilityId)
      : this.db
          .prepare('SELECT task_json FROM tool_tasks ORDER BY started_at DESC LIMIT 220')
          .all()) as unknown as Array<{ task_json: string }>
    return rows.map((r) => JSON.parse(r.task_json) as ToolTask)
  }
  metadata(capabilityId?: string): ToolTask[] {
    const where = capabilityId ? ' WHERE capability_id=?' : ''
    const rows = this.db
      .prepare(
        `SELECT json_remove(task_json,'$.result','$.stdout','$.stderr','$.events') AS task_json FROM tool_tasks${where} ORDER BY started_at DESC LIMIT 220`,
      )
      .all(...(capabilityId ? [capabilityId] : [])) as unknown as Array<{ task_json: string }>
    return rows.map((r) =>
      this.withReplay({ ...JSON.parse(r.task_json), stdout: '', stderr: '', result: null }),
    )
  }
  get(id: string): ToolTask {
    const row = this.db.prepare('SELECT task_json FROM tool_tasks WHERE id=?').get(id) as
      { task_json: string } | undefined
    if (!row) throw new ToolError('task_not_found')
    return this.withReplay(JSON.parse(row.task_json) as ToolTask)
  }
  private withReplay(task: ToolTask): ToolTask {
    return {
      ...task,
      canRestart: this.recent.has(task.id) && !['running', 'stopping'].includes(task.status),
    }
  }
  private event(a: Active, message: string): void {
    const events = (a.task.events ??= [])
    if (events.length < 64) events.push({ at: now(), message })
    this.store(a.task)
  }
  start(
    def: CapabilityDefinition,
    tool: CapabilityTool,
    args: JsonObject,
    source: TaskSource,
    overrides?: ToolRunOverrides,
    transient = false,
  ): ToolTask {
    if (this.closing || this.active.size >= 16) throw new ToolError('tool_busy')
    const task: ToolTask = {
      id: randomUUID(),
      capabilityId: def.id,
      capabilityName: def.name,
      operation: `${def.namespace}.${tool.name}`,
      version: def.version,
      runnerType: def.runner.type,
      source,
      status: 'running',
      startedAt: now(),
      finishedAt: null,
      result: null,
      error: null,
      stdout: '',
      stderr: '',
      truncated: false,
      cancellationUncertain: false,
      events: [{ at: now(), message: '任务已创建' }],
    }
    const a: Active = {
      task,
      def: structuredClone(def),
      tool: structuredClone(tool),
      args: structuredClone(args),
      transient,
      previous:
        def.runner.type === 'terminal'
          ? [...this.active.values()].filter((previous) => previous.task.capabilityId === def.id)
          : [],
      controller: new AbortController(),
      done: Promise.resolve(task),
    }
    this.active.set(task.id, a)
    this.store(task)
    this.recent.set(task.id, {
      name: task.operation,
      args: structuredClone(args),
      version: def.version,
      overrides: overrides ? structuredClone(overrides) : undefined,
    })
    if (this.recent.size > 200) this.recent.delete(this.recent.keys().next().value!)
    a.done = this.execute(a)
    return structuredClone(task)
  }
  async wait(id: string): Promise<ToolTask> {
    return this.active.get(id)?.done ?? this.get(id)
  }
  restartInput(id: string): {
    name: string
    args: JsonObject
    version: number
    overrides?: ToolRunOverrides
  } {
    const value = this.recent.get(id)
    if (!value || ['running', 'stopping'].includes(this.get(id).status))
      throw new ToolError('task_restart_unavailable')
    return value
  }
  stop(id: string): ToolTask {
    const a = this.active.get(id)
    if (!a) return this.get(id)
    if (a.task.status === 'stopping') return structuredClone(a.task)
    a.task.status = 'stopping'
    this.event(a, '已请求停止')
    a.controller.abort('cancelled')
    return structuredClone(a.task)
  }
  private async execute(a: Active): Promise<ToolTask> {
    const secret = secrets(a.def)
    const timeout =
      a.def.runner.type === 'terminal'
        ? null
        : setTimeout(
            () => a.controller.abort('timeout'),
            a.def.runner.settings.type === 'http' ? a.def.runner.settings.timeoutMs : 300000,
          )
    try {
      let result: JsonValue
      if (a.def.runner.settings.type === 'terminal') result = await this.terminal(a, secret)
      else if (a.def.runner.settings.type === 'http') result = await this.http(a)
      else {
        const args = mergeMcpArguments(a.tool, a.args)
        const raw = (await this.mcp.call(
          a.def,
          a.tool,
          args,
          a.controller.signal,
          (message) => this.event(a, message),
          a.transient,
        )) as JsonValue
        result =
          a.tool.upstreamOutputSchemaMissing && !Object.keys(a.tool.outputSchema).length
            ? raw
            : projectOutput(raw, a.tool.outputSchema)
      }
      const serialized = JSON.stringify(result)
      if (Buffer.byteLength(serialized) > LIMIT) throw new ToolError('tool_output_too_large')
      // Redact values recursively before serialization so numeric/private values stay private too.
      const clean = (value: JsonValue): JsonValue => {
        if (typeof value === 'string') return redact(value, secret)
        if (Array.isArray(value)) return value.map(clean)
        if (record(value))
          return Object.fromEntries(
            Object.entries(value)
              .filter(([key]) => !secret.some((s) => key.includes(s)))
              .map(([key, v]) => [key, clean(v as JsonValue)]),
          )
        return secret.includes(JSON.stringify(value)) ? null : value
      }
      a.task.result = clean(result)
      a.task.status =
        a.task.runnerType === 'terminal' && record(result) && result.exitCode !== 0
          ? 'failed'
          : 'completed'
    } catch (error) {
      if (a.controller.signal.aborted) {
        a.task.status = a.controller.signal.reason === 'timeout' ? 'timed_out' : 'cancelled'
        a.task.cancellationUncertain = a.task.runnerType !== 'terminal'
      } else {
        a.task.status = 'failed'
        a.task.error = error instanceof ToolError ? error.code : 'tool_execution_failed'
      }
    } finally {
      if (timeout) clearTimeout(timeout)
      a.task.finishedAt = now()
      this.event(
        a,
        a.task.status === 'completed'
          ? '执行完成'
          : a.task.status === 'timed_out'
            ? '执行超时'
            : a.task.status === 'cancelled'
              ? '执行已取消'
              : '执行失败',
      )
      this.active.delete(a.task.id)
      this.store(a.task)
    }
    return structuredClone(a.task)
  }
  private async terminal(a: Active, secret: string[]): Promise<JsonObject> {
    if (a.previous.length) {
      this.event(a, '正在停止同一工具的上一次运行')
      for (const previous of a.previous) this.stop(previous.task.id)
      await Promise.all(a.previous.map((previous) => previous.done))
    }
    if (a.controller.signal.aborted) throw new ToolError('tool_execution_failed')
    const system = await systemTerminalEnvironment(a.controller.signal)
    if (a.controller.signal.aborted) throw new ToolError('tool_execution_failed')
    return new Promise((resolve, reject) => {
      const s = a.def.runner.settings
      if (s.type !== 'terminal') {
        reject(new ToolError('tool_config_invalid'))
        return
      }
      const command = s.command ?? a.args.command
      if (typeof command !== 'string') {
        reject(new ToolError('invalid_tool_arguments'))
        return
      }
      const shell = !s.shell || s.shell === 'auto' ? system.shell : s.shell
      const environment = { ...system.environment, ...s.environment }
      delete environment.LUMIPLUG_HOST_TOKEN
      if (s.command !== undefined)
        for (const f of a.tool.fields) {
          const value = f.aiVisible ? a.args[f.key] : f.value
          if (value !== undefined && value !== null)
            environment[f.key] = typeof value === 'string' ? value : JSON.stringify(value)
        }
      delete environment.LUMIPLUG_SESSION_TOKEN
      const child = spawn(shell, terminalCommandArguments(shell, command), {
        cwd: terminalDirectory(s.cwd),
        env: withoutLumiCredentials(environment),
        detached: process.platform !== 'win32',
        windowsVerbatimArguments: process.platform === 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      a.process = child
      child.once('spawn', () => this.event(a, '命令进程已启动'))
      let stdout = '',
        stderr = ''
      const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') }
      let flushTimer: ReturnType<typeof setTimeout> | undefined
      const hold = Math.max(0, ...secret.map((s) => s.length))
      const flush = (final = false) => {
        const safe = (text: string) => {
          const clean = redact(text, secret)
          return final && !a.task.truncated
            ? clean
            : clean.slice(0, Math.max(0, clean.length - hold))
        }
        a.task.stdout = safe(stdout)
        a.task.stderr = safe(stderr)
        this.store(a.task)
        flushTimer = undefined
      }
      const append = (kind: 'stdout' | 'stderr', chunk: Buffer) => {
        const text = decoders[kind].write(chunk)
        if (kind === 'stdout') {
          a.task.truncated ||= stdout.length + text.length > LIMIT
          stdout = (stdout + text).slice(0, LIMIT)
        } else {
          a.task.truncated ||= stderr.length + text.length > LIMIT
          stderr = (stderr + text).slice(0, LIMIT)
        }
        // Withhold a suffix long enough to cover secrets split across stream chunks.
        if (!flushTimer) flushTimer = setTimeout(() => flush(), 150)
      }
      child.stdout?.on('data', (c: Buffer) => append('stdout', c))
      child.stderr?.on('data', (c: Buffer) => append('stderr', c))
      let killTimer: ReturnType<typeof setTimeout> | undefined
      const kill = (signal: NodeJS.Signals) => {
        if (!child.pid) return
        if (process.platform === 'win32')
          spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
        else {
          try {
            process.kill(-child.pid, signal)
          } catch {
            /* Process group already exited. */
          }
        }
      }
      const abort = () => {
        kill('SIGTERM')
        killTimer = setTimeout(() => kill('SIGKILL'), 300)
      }
      a.controller.signal.addEventListener('abort', abort, { once: true })
      if (a.controller.signal.aborted) abort()
      child.once('error', () => reject(new ToolError('tool_execution_failed')))
      child.once('close', (code) => {
        if (killTimer) clearTimeout(killTimer)
        if (flushTimer) clearTimeout(flushTimer)
        // Also terminate descendants left by a command that backgrounds itself.
        kill('SIGKILL')
        a.controller.signal.removeEventListener('abort', abort)
        stdout += decoders.stdout.end()
        stderr += decoders.stderr.end()
        flush(true)
        if (a.controller.signal.aborted) reject(new ToolError('tool_execution_failed'))
        else
          resolve({
            stdout: a.task.stdout,
            stderr: a.task.stderr,
            exitCode: code,
            truncated: a.task.truncated,
          })
      })
    })
  }
  private async http(a: Active): Promise<JsonValue> {
    const s = a.def.runner.settings
    if (s.type !== 'http') throw new ToolError('tool_config_invalid')
    let template = s.url
    const headers = new Headers(s.fixedHeaders)
    const body: JsonObject = record(s.body) ? (structuredClone(s.body) as JsonObject) : {}
    const query: Array<[string, string]> = []
    for (const f of a.tool.fields) {
      const value = f.aiVisible ? a.args[f.key] : f.value
      if (value === undefined || !f.binding) continue
      const text = typeof value === 'string' ? value : JSON.stringify(value)
      const { location, key } = f.binding
      if (location === 'path') template = template.split(`{${key}}`).join(encodeURIComponent(text))
      else if (location === 'query') query.push([key, text])
      else if (location === 'header') headers.set(key, text)
      else if (location === 'body') body[key] = value
    }
    if (/\{[^}]+\}/.test(template)) throw new ToolError('tool_config_incomplete')
    const url = safeUrl(template)
    for (const [key, value] of query) url.searchParams.set(key, value)
    const hasBody = Object.keys(body).length > 0
    const encodedBody =
      s.bodyMode === 'form'
        ? new URLSearchParams(
            Object.entries(body).map(([key, value]) => [
              key,
              typeof value === 'string' ? value : JSON.stringify(value),
            ]),
          ).toString()
        : JSON.stringify(body)
    if (hasBody && !headers.has('content-type'))
      headers.set(
        'content-type',
        s.bodyMode === 'form' ? 'application/x-www-form-urlencoded' : 'application/json',
      )
    this.event(a, '开始发送请求')
    const response = await fetch(url, {
      method: s.method,
      headers,
      ...(hasBody ? { body: encodedBody } : {}),
      signal: a.controller.signal,
      redirect: 'error',
    })
    this.event(a, `收到响应（HTTP ${response.status}）`)
    if (!response.ok) {
      await response.body?.cancel()
      throw new ToolError('tool_http_failed')
    }
    const reader = response.body?.getReader()
    let size = 0
    const chunks: Uint8Array[] = []
    if (reader)
      while (true) {
        const read = await reader.read()
        if (read.done) break
        size += read.value.byteLength
        if (size > 1024 * 1024) {
          await reader.cancel()
          throw new ToolError('tool_output_too_large')
        }
        chunks.push(read.value)
      }
    const text = Buffer.concat(chunks).toString('utf8')
    this.event(a, '响应读取完成')
    if (s.responseMode === 'text' && s.responseFilter === undefined)
      return projectOutput({ status: response.status, body: text }, a.tool.outputSchema)
    let data: JsonValue
    try {
      data = text ? (JSON.parse(text) as JsonValue) : {}
    } catch {
      data = { text }
    }
    return s.responseFilter !== undefined
      ? filterResponse(data, s.responseFilter, a.controller.signal)
      : projectOutput(data, a.tool.outputSchema)
  }
  async close(): Promise<void> {
    this.closing = true
    const active = [...this.active.values()]
    for (const a of active) this.stop(a.task.id)
    await Promise.allSettled(active.map((a) => a.done))
    await this.mcp.close()
    this.recent.clear()
  }
}
