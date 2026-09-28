// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from './migrations'

export class CoreDatabase {
  public readonly raw: DatabaseSync

  public constructor(filename: string) {
    if (filename !== ':memory:') {
      fs.mkdirSync(path.dirname(filename), { recursive: true })
    }
    this.raw = new DatabaseSync(filename)
    applyMigrations(this.raw)
  }

  public close(): void {
    this.raw.close()
  }
}
