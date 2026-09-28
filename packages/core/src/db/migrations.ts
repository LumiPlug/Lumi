// SPDX-License-Identifier: MPL-2.0

import type { DatabaseSync } from 'node:sqlite'

export interface Migration {
  id: number
  name: string
  sql: string
}

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'capability_canonical_model',
    sql: `
      CREATE TABLE IF NOT EXISTS capabilities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        namespace TEXT NOT NULL,
        description TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version > 0),
        source TEXT NOT NULL CHECK (source IN ('ui', 'ai', 'import')),
        status TEXT NOT NULL CHECK (status IN ('draft', 'ready', 'disabled')),
        enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (enabled = 0 OR status = 'ready')
      );

      CREATE TABLE IF NOT EXISTS runner_configs (
        capability_id TEXT PRIMARY KEY REFERENCES capabilities(id) ON DELETE CASCADE,
        runner_type TEXT NOT NULL CHECK (runner_type IN ('terminal', 'http', 'mcp')),
        settings_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS capability_tools (
        capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        output_schema_json TEXT NOT NULL,
        position INTEGER NOT NULL,
        PRIMARY KEY (capability_id, name)
      );

      CREATE TABLE IF NOT EXISTS capability_tool_fields (
        capability_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        field_key TEXT NOT NULL,
        schema_json TEXT NOT NULL,
        required INTEGER NOT NULL CHECK (required IN (0, 1)),
        ai_visible INTEGER NOT NULL CHECK (ai_visible IN (0, 1)),
        value_json TEXT NOT NULL DEFAULT 'null',
        binding_json TEXT,
        position INTEGER NOT NULL,
        PRIMARY KEY (capability_id, tool_name, field_key),
        FOREIGN KEY (capability_id, tool_name)
          REFERENCES capability_tools(capability_id, name) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS capability_versions (
        capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
        version INTEGER NOT NULL CHECK (version > 0),
        definition_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (capability_id, version)
      );

      CREATE INDEX IF NOT EXISTS idx_capabilities_status_enabled
        ON capabilities(status, enabled);
      CREATE INDEX IF NOT EXISTS idx_capability_tools_name
        ON capability_tools(name);
    `,
  },
]

export function applyMigrations(database: DatabaseSync): void {
  database.exec('PRAGMA foreign_keys = ON;')
  database.exec('PRAGMA journal_mode = WAL;')
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `)

  for (const migration of MIGRATIONS) {
    const existing = database
      .prepare('SELECT id FROM schema_migrations WHERE id = ?')
      .get(migration.id) as { id: number } | undefined
    if (existing) {
      continue
    }

    database.exec('BEGIN IMMEDIATE;')
    try {
      database.exec(migration.sql)
      database
        .prepare(
          'INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)',
        )
        .run(migration.id, migration.name, new Date().toISOString())
      database.exec('COMMIT;')
    } catch (error) {
      database.exec('ROLLBACK;')
      throw error
    }
  }
}
