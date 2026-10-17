// SPDX-License-Identifier: MPL-2.0

import { createCapabilityDefinition, type CapabilityDefinition } from '@lumiplug/shared'
import { describe, expect, it } from 'vitest'
import { CoreDatabase } from './db/database'
import { CapabilityRegistry } from './capability/registry'
import { CapabilityRepository } from './capability/repository'

function definitionWithCanary(): CapabilityDefinition {
  const definition = createCapabilityDefinition({
    kind: 'terminal',
    name: 'canary-demo',
    namespace: 'local',
  })
  const tool = definition.tools[0]
  if (!tool) {
    throw new Error('test_tool_missing')
  }
  return {
    ...definition,
    runner: {
      type: 'terminal',
      settings: {
        type: 'terminal',
        cwd: '.',
        shell: 'auto',
        environment: {
          LUMIPLUG_INTERNAL_CANARY_VALUE: 'CANARY-VALUE-DO-NOT-LEAK',
        },
      },
    },
    tools: [
      {
        ...tool,
        fields: [
          ...tool.fields,
          {
            key: 'internal_canary_field',
            schema: { type: 'string' },
            required: false,
            aiVisible: false,
            value: 'CANARY-VALUE-DO-NOT-LEAK',
            binding: { location: 'argument', key: 'internal_canary_binding' },
          },
        ],
      },
    ],
  }
}

describe('Capability Registry', () => {
  it('keeps draft tools out of the AI view and projects only visible fields', async () => {
    const database = new CoreDatabase(':memory:')
    const repository = new CapabilityRepository(database.raw)
    const registry = new CapabilityRegistry(repository)
    const definition = definitionWithCanary()

    repository.saveDraft(definition)
    expect(registry.listAiTools()).toHaveLength(0)

    const enabled = registry.enable(definition.id, 'ui')
    const view = registry.getAiTool('local.run')
    expect(view).not.toBeNull()
    expect(enabled.tools[0]?.fields.some((field) => field.key === 'internal_canary_field')).toBe(
      true,
    )

    const serializedView = JSON.stringify(view)
    expect(serializedView).not.toContain('internal_canary_field')
    expect(serializedView).not.toContain('CANARY-VALUE-DO-NOT-LEAK')
    expect(view?.inputSchema.properties).toEqual({ command: { type: 'string', minLength: 1 } })

    const resolved = registry.resolveForExecution('local.run')
    expect(resolved.tools[0]?.fields[1]?.value).toBe('CANARY-VALUE-DO-NOT-LEAK')
    await expect(registry.invoke('local.run', { command: 'echo test' })).rejects.toThrow(
      'runner_execution_not_implemented_until_m4_m6',
    )
    database.close()
  })

  it('supports all three draft kinds without claiming runner execution', () => {
    const database = new CoreDatabase(':memory:')
    const repository = new CapabilityRepository(database.raw)
    const registry = new CapabilityRegistry(repository)
    const drafts = [
      registry.saveDraft({ kind: 'terminal', name: 'terminal-draft' }),
      registry.saveDraft({ kind: 'http', name: 'http-draft', url: 'http://127.0.0.1' }),
      registry.saveDraft({ kind: 'mcp', name: 'mcp-draft', transport: 'stdio' }),
    ]

    expect(drafts.map((draft) => draft.runner.type)).toEqual(['terminal', 'http', 'mcp'])
    expect(repository.listSummaries().every((summary) => summary.status === 'draft')).toBe(true)
    database.close()
  })

  it('applies schema migration settings once with foreign keys and WAL configured', () => {
    const database = new CoreDatabase(':memory:')
    const foreignKeys = database.raw.prepare('PRAGMA foreign_keys').get() as {
      foreign_keys: number
    }
    const migration = database.raw
      .prepare('SELECT id, name FROM schema_migrations')
      .all() as unknown as Array<{ id: number; name: string }>
    expect(foreignKeys.foreign_keys).toBe(1)
    expect(migration).toEqual([
      { id: 1, name: 'capability_canonical_model' },
      { id: 2, name: 'workbench_versions' },
      { id: 3, name: 'skill_inventory' },
      { id: 4, name: 'tool_tasks_and_upstream_names' },
      { id: 5, name: 'tool_archives' },
      { id: 6, name: 'knowledge_versions_and_builds' },
      { id: 7, name: 'knowledge_source_metadata_only' },
      { id: 8, name: 'knowledge_project_branch_groups' },
      { id: 9, name: 'mcp_upstream_schema_provenance' },
      { id: 10, name: 'knowledge_build_status_index' },
      { id: 11, name: 'host_task_input_snapshots' },
      { id: 12, name: 'ai_token_usage' },
    ])
    database.close()
  })
})
