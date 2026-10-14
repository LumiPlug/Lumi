// SPDX-License-Identifier: MPL-2.0
import { createHash } from 'node:crypto'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import type { CapabilityDefinition, CapabilityTool, JsonObject, JsonSchema } from '@lumiplug/shared'
import { CORE_VERSION } from '@lumiplug/shared'
import { ToolError, safeUrl, validateMcpArguments } from './config'

function stable(value: unknown): unknown {
  return Array.isArray(value)
    ? value.map(stable)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, stable(v)]),
        )
      : value
}

/** A cancelled caller stops waiting without aborting another caller's shared connection. */
function waitFor<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      cleanup()
      reject(signal.reason)
    }
    const cleanup = () => signal.removeEventListener('abort', abort)
    if (signal.aborted) {
      void promise.catch(() => {})
      reject(signal.reason)
      return
    }
    signal.addEventListener('abort', abort, { once: true })
    promise.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error) => {
        cleanup()
        reject(error)
      },
    )
  })
}

interface Session {
  client: Promise<Client>
  controller: AbortController
  users: number
  connected: boolean
  invalid: boolean
}

export class McpConnections {
  private sessions = new Map<string, Session>()
  constructor(private readonly changed: (definition: CapabilityDefinition) => void) {}
  private async connect(
    def: CapabilityDefinition,
    watch = true,
    signal?: AbortSignal,
  ): Promise<Client> {
    const s = def.runner.settings
    if (s.type !== 'mcp') throw new ToolError('tool_config_invalid')
    const environment = { ...process.env, ...s.environment } as Record<string, string>
    delete environment.LUMIPLUG_HOST_TOKEN
    delete environment.LUMIPLUG_SESSION_TOKEN
    const client = new Client({ name: 'Lumi upstream', version: CORE_VERSION })
    if (watch)
      client.setNotificationHandler('notifications/tools/list_changed', () => this.changed(def))
    const deadline = AbortSignal.timeout(10000)
    try {
      await client.connect(
        s.transport === 'stdio'
          ? new StdioClientTransport({
              command: s.command ?? '',
              args: s.args,
              env: environment,
              stderr: 'ignore',
            })
          : new StreamableHTTPClientTransport(safeUrl(s.url ?? ''), {
              requestInit: { headers: s.headers ?? {}, redirect: 'error' },
            }),
        { timeout: 10000, signal: signal ? AbortSignal.any([signal, deadline]) : deadline },
      )
      return client
    } catch {
      await client.close().catch(() => {})
      throw new ToolError('tool_mcp_failed')
    }
  }
  private async catalog(
    client: Client,
    toolName?: string,
    caller?: AbortSignal,
  ): Promise<CapabilityTool[]> {
    const deadline = AbortSignal.timeout(10000)
    const signal = caller ? AbortSignal.any([caller, deadline]) : deadline
    const tools: CapabilityTool[] = []
    let cursor: string | undefined
    const cursors = new Set<string>()
    let pages = 0
    do {
      signal.throwIfAborted()
      if (++pages > 128) throw new ToolError('tool_config_invalid')
      const page = await client.listTools(cursor ? { cursor } : {}, {
        timeout: 10000,
        signal,
        cacheMode: 'refresh',
      })
      for (const t of page.tools) {
        if (toolName?.trim() && t.name !== toolName.trim()) continue
        if (tools.length >= 128) throw new ToolError('tool_config_invalid')
        const schema = t.inputSchema as JsonSchema
        if (schema.additionalProperties === true) throw new ToolError('tool_schema_invalid')
        const raw = t.name.replace(/[^A-Za-z0-9._-]/g, '_')
        const name = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(t.name)
          ? t.name
          : `op_${raw.slice(0, 40)}_${createHash('sha256').update(t.name).digest('hex').slice(0, 8)}`
        tools.push({
          name,
          upstreamName: t.name,
          upstreamSignature: createHash('sha256')
            .update(
              JSON.stringify(
                stable({ name: t.name, input: t.inputSchema, output: t.outputSchema ?? null }),
              ),
            )
            .digest('hex'),
          upstreamInputSchema: structuredClone(schema),
          upstreamOutputSchemaMissing: t.outputSchema === undefined,
          description: t.description ?? '',
          fields: Object.entries(schema.properties ?? {}).map(([key, value]) => ({
            key,
            schema: value,
            required: schema.required?.includes(key) ?? false,
            aiVisible: true,
            value: null,
            binding: { location: 'mcpArgument', key },
          })),
          outputSchema: (t.outputSchema as JsonSchema | undefined) ?? {},
        })
      }
      cursor = page.nextCursor
      if (cursor && cursors.has(cursor)) throw new ToolError('tool_mcp_failed')
      if (cursor) cursors.add(cursor)
    } while (cursor)
    if (!tools.length) throw new ToolError('tool_config_incomplete')
    return tools
  }
  async discover(def: CapabilityDefinition, caller?: AbortSignal): Promise<CapabilityTool[]> {
    const deadline = AbortSignal.timeout(10000)
    const signal = caller ? AbortSignal.any([caller, deadline]) : deadline
    const client = await this.connect(def, false, signal)
    try {
      return await this.catalog(
        client,
        def.runner.settings.type === 'mcp' ? def.runner.settings.toolName : undefined,
        signal,
      )
    } finally {
      await client.close().catch(() => {})
    }
  }
  private async closeSession(session: Session): Promise<void> {
    session.controller.abort()
    await session.client.then((c) => c.close()).catch(() => {})
  }
  async call(
    def: CapabilityDefinition,
    tool: CapabilityTool,
    args: JsonObject,
    signal: AbortSignal,
    onEvent?: (message: string) => void,
    transient = false,
  ): Promise<unknown> {
    signal.throwIfAborted()
    onEvent?.('正在获取服务连接')
    const key = `${def.id}:${def.version}:${transient ? 'manual' : 'saved'}:${createHash('sha256')
      .update(JSON.stringify(stable(def.runner.settings)))
      .digest('hex')}`
    let session = this.sessions.get(key)
    if (!session) {
      while (!session && this.sessions.size >= 16) {
        const unused = [...this.sessions].find(([, s]) => !s.users)
        if (!unused) throw new ToolError('tool_busy')
        this.sessions.delete(unused[0])
        await this.closeSession(unused[1])
        signal.throwIfAborted()
        session = this.sessions.get(key)
      }
    }
    if (!session) {
      const controller = new AbortController()
      const created: Session = {
        client: this.connect(def, !transient, controller.signal),
        controller,
        users: 0,
        connected: false,
        invalid: false,
      }
      created.client = created.client.then(
        (c) => {
          created.connected = true
          return c
        },
        (error) => {
          created.invalid = true
          if (this.sessions.get(key) === created) this.sessions.delete(key)
          throw error
        },
      )
      session = created
      this.sessions.set(key, session)
    }
    session.users++
    try {
      const client = await waitFor(session.client, signal)
      signal.throwIfAborted()
      onEvent?.('服务连接已就绪，开始校验操作')
      const actual = await this.catalog(
        client,
        def.runner.settings.type === 'mcp' ? def.runner.settings.toolName : undefined,
        signal,
      ).catch((error) => {
        if (error instanceof ToolError && error.code === 'tool_config_incomplete') {
          if (!transient) this.changed(def)
          throw new ToolError('tool_mcp_changed')
        }
        throw error
      })
      const compatible =
        actual.length === def.tools.length &&
        actual.every((t) =>
          def.tools.some(
            (old) =>
              old.upstreamName === t.upstreamName && old.upstreamSignature === t.upstreamSignature,
          ),
        )
      if (!compatible) {
        if (!transient) this.changed(def)
        throw new ToolError('tool_mcp_changed')
      }
      const current = actual.find((t) => t.upstreamName === tool.upstreamName)!
      if (!validateMcpArguments(current, args, true)) throw new ToolError('invalid_tool_arguments')
      // Old automatic text schemas cannot be distinguished from the same explicit user allow-list.
      // Require review before execution rather than widening it or silently discarding structure.
      if (
        tool.upstreamOutputSchemaMissing === undefined &&
        current.upstreamOutputSchemaMissing &&
        JSON.stringify(stable(tool.outputSchema)) ===
          JSON.stringify(
            stable({
              type: 'object',
              properties: { text: { type: 'string' } },
              additionalProperties: false,
            }),
          )
      )
        throw new ToolError('tool_mcp_schema_refresh_required')
      onEvent?.('操作校验通过，开始调用')
      const result = await client.callTool(
        { name: tool.upstreamName!, arguments: args },
        { signal, timeout: 300000 },
      )
      if (result.isError) throw new ToolError('tool_mcp_failed')
      onEvent?.('已收到操作结果')
      // Refresh missing-schema provenance for old cached records without modifying persisted configuration.
      tool.upstreamOutputSchemaMissing = current.upstreamOutputSchemaMissing
      return (
        result.structuredContent ?? {
          text: result.content
            .filter((c) => c.type === 'text')
            .map((c) => c.text)
            .join('\n'),
        }
      )
    } catch (error) {
      // Business/configuration errors and one caller's cancellation do not close other users' requests.
      if (!signal.aborted && !(error instanceof ToolError)) {
        session.invalid = true
        if (this.sessions.get(key) === session) this.sessions.delete(key)
      }
      if (error instanceof ToolError) throw error
      throw new ToolError('tool_mcp_failed')
    } finally {
      session.users--
      if (!session.users && (!session.connected || session.invalid)) {
        if (this.sessions.get(key) === session) this.sessions.delete(key)
        await this.closeSession(session)
      }
    }
  }
  async close(): Promise<void> {
    await Promise.allSettled([...this.sessions.values()].map((s) => this.closeSession(s)))
    this.sessions.clear()
  }
}
