// SPDX-License-Identifier: MPL-2.0
import type { CapabilityDefinition, CapabilityTool } from '@lumiplug/shared'
/** MCP options are the saved discovery catalog, never a placeholder or an invented operation. */
export function availableRunOperations(definition: CapabilityDefinition): CapabilityTool[] {
  return definition.runner.type === 'mcp'
    ? definition.tools.filter(
        (tool) => !!tool.upstreamName?.trim() && !!tool.upstreamSignature?.trim(),
      )
    : definition.tools
}
export function initialRunOperation(definition: CapabilityDefinition): string {
  const tools = availableRunOperations(definition)
  if (definition.runner.type === 'terminal')
    return tools.find((tool) => tool.name === 'run')?.name ?? tools[0]?.name ?? ''
  const settings = definition.runner.settings
  if (settings.type === 'mcp' && settings.toolName)
    return tools.find((tool) => tool.upstreamName === settings.toolName)?.name ?? ''
  return tools.length === 1 ? tools[0]!.name : ''
}
