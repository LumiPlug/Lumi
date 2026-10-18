// SPDX-License-Identifier: MPL-2.0
import os from 'node:os'
import {
  nativeUsageSoftwareIds,
  usageSoftwareNames,
  type NativeUsageSoftware,
} from '@lumiplug/shared'
import type { Cache, Provider } from '../../vendor/codeburn/reader.cjs'
import { CodeburnCollector } from './codeburn'
import { NativeUsageCollector, nativeUsageRoots, type NativeUsageRoot } from './native'

/** One Core/scan/query pipeline; Lumi readers do not modify the pinned upstream reader. */
export class UsageCollector extends CodeburnCollector {
  private readonly native: NativeUsageCollector
  constructor(cache?: Cache, roots: NativeUsageRoot[] = nativeUsageRoots(os.homedir())) {
    super(cache)
    this.native = new NativeUsageCollector(roots)
  }
  override async providers(): Promise<Provider[]> {
    return [
      ...nativeUsageSoftwareIds.map((name) => ({
        name,
        displayName: usageSoftwareNames[name],
        discoverSessions: async () => [],
      })),
      ...(await super.providers()),
    ]
  }
  override collect(provider: Provider, stopped: () => boolean = () => false) {
    return (nativeUsageSoftwareIds as readonly string[]).includes(provider.name)
      ? this.native.collect(provider.name as NativeUsageSoftware, stopped)
      : super.collect(provider, stopped)
  }
}
