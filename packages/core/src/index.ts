// SPDX-License-Identifier: MPL-2.0

import { parseRuntimeConfig } from './config'
import { isSea } from 'node:sea'
import { CoreService, genericErrorPayload, writeReadyHandshake } from './service'

async function main(): Promise<void> {
  let service: CoreService
  let stopping = false
  const stop = (): void => {
    if (stopping) return
    stopping = true
    void service.stop().finally(() => process.exit(0))
  }
  try {
    const options = parseRuntimeConfig()
    service = new CoreService({ ...options, emitReady: writeReadyHandshake, onStopRequested: stop })
    await service.start()
  } catch (error) {
    process.stderr.write(`${JSON.stringify(genericErrorPayload(error))}\n`)
    process.exitCode = 1
    return
  }

  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
}

if (isSea() || require.main === module) {
  void main()
}
