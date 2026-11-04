// SPDX-License-Identifier: MPL-2.0
import Ajv from 'ajv'
import type { AiToolView } from '@lumiplug/shared'
import catalog from './advanced-tools.json'
const ajv = new Ajv({ allErrors: false, strict: false })
export const ADVANCED_TOOLS = catalog.map((tool) => ({
  ...tool,
  name: `Lumi.browser_${tool.name}`,
})) as unknown as AiToolView[]
const validators = new Map(catalog.map((tool) => [tool.name, ajv.compile(tool.inputSchema)]))
export function validateAdvanced(tool: string, args: unknown): boolean | undefined {
  const validate = validators.get(tool)
  return validate ? !!validate(args) : undefined
}
