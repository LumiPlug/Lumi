// SPDX-License-Identifier: MPL-2.0

import { parseRuntimeConfig } from './config'
import { CoreService, genericErrorPayload, writeReadyHandshake } from './service'

export * from './capability/registry'
export * from './capability/repository'
export * from './config'
export * from './db/database'
export * from './db/migrations'
export * from './service'

async function main(): Promise<void> {
  let service: CoreService
  try {
    const options = parseRuntimeConfig()
    service = new CoreService({ ...options, emitReady: writeReadyHandshake })
    await service.start()
  } catch (error) {
    process.stderr.write(`${JSON.stringify(genericErrorPayload(error))}\n`)
    process.exitCode = 1
    return
  }

  const stop = (): void => {
    void service.stop().finally(() => process.exit(0))
  }
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
}

if (require.main === module) {
  void main()
}
