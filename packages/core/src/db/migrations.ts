// SPDX-License-Identifier: MPL-2.0

import type { DatabaseSync } from 'node:sqlite'

interface Migration {
  id: number
  name: string
  sql: string
}

const MIGRATIONS: Migration[] = [
  {
    id: 9,
    name: 'mcp_upstream_schema_provenance',
    sql: `ALTER TABLE capability_tools ADD COLUMN upstream_input_schema_json TEXT;
          ALTER TABLE capability_tools ADD COLUMN upstream_output_schema_missing INTEGER CHECK (upstream_output_schema_missing IN (0, 1));`,
  },
  {
    id: 8,
    name: 'knowledge_project_branch_groups',
    sql: `
      DROP TABLE knowledge_batches;
      DROP TABLE knowledge_builds;
      DROP TABLE knowledge_preparations;
      DROP TABLE knowledge_revisions;
      DROP TABLE knowledge_source_files;
      DROP TABLE knowledge_scans;
      DROP TABLE knowledge_sources;
      DROP TABLE knowledge_fts;
      DROP TABLE knowledge_libraries;
      CREATE TABLE knowledge_libraries (id TEXT PRIMARY KEY, project_key TEXT NOT NULL, branch TEXT NOT NULL, metadata TEXT NOT NULL, UNIQUE(project_key,branch));
      CREATE TABLE knowledge_preparations (kb_id TEXT NOT NULL, token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
      CREATE TABLE knowledge_builds (id TEXT PRIMARY KEY, kb_id TEXT NOT NULL REFERENCES knowledge_libraries(id), token_hash TEXT NOT NULL, request_key TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(kb_id,request_key));
      CREATE TABLE knowledge_batches (build_id TEXT NOT NULL REFERENCES knowledge_builds(id), batch_id TEXT NOT NULL, hash TEXT NOT NULL, seq INTEGER NOT NULL, PRIMARY KEY(build_id,batch_id));
      CREATE TABLE knowledge_revisions (kb_id TEXT NOT NULL REFERENCES knowledge_libraries(id), revision INTEGER NOT NULL, commit_sha TEXT, data TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(kb_id,revision));
      CREATE VIRTUAL TABLE knowledge_fts USING fts5(kb_id UNINDEXED, revision UNINDEXED, kind UNINDEXED, target_id UNINDEXED, title UNINDEXED, tokens, tokenize='unicode61');
      INSERT OR IGNORE INTO knowledge_privacy_cleanup VALUES (7);
    `,
  },
  {
    id: 7,
    name: 'knowledge_source_metadata_only',
    sql: `
      CREATE TABLE knowledge_source_files (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, manifest_id TEXT NOT NULL, file_id TEXT NOT NULL, path TEXT NOT NULL, hash TEXT NOT NULL, bytes INTEGER NOT NULL, lines INTEGER NOT NULL, UNIQUE(manifest_id,file_id));
      INSERT INTO knowledge_source_files
        SELECT id,source_id,manifest_id,file_id,path,hash,length(CAST(text AS BLOB)),length(text)-length(replace(text,char(10),''))+1 FROM knowledge_snapshots;
      DROP TABLE knowledge_snapshots;
      UPDATE knowledge_sources SET root='导入知识库' WHERE root='导入快照';
      CREATE TABLE knowledge_privacy_cleanup (id INTEGER PRIMARY KEY);
      INSERT INTO knowledge_privacy_cleanup VALUES (7);
    `,
  },
  {
    id: 6,
    name: 'knowledge_versions_and_builds',
    sql: `
      CREATE TABLE knowledge_libraries (id TEXT PRIMARY KEY, metadata TEXT NOT NULL);
      CREATE TABLE knowledge_sources (id TEXT PRIMARY KEY, kb_id TEXT NOT NULL REFERENCES knowledge_libraries(id), root TEXT NOT NULL, grant_state TEXT NOT NULL, request_key TEXT NOT NULL UNIQUE);
      CREATE TABLE knowledge_scans (id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES knowledge_sources(id), request_key TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(source_id, request_key));
      CREATE TABLE knowledge_snapshots (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, manifest_id TEXT NOT NULL, file_id TEXT NOT NULL, path TEXT NOT NULL, hash TEXT NOT NULL, text TEXT NOT NULL, UNIQUE(manifest_id,file_id));
      CREATE TABLE knowledge_preparations (kb_id TEXT NOT NULL, token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
      CREATE TABLE knowledge_builds (id TEXT PRIMARY KEY, kb_id TEXT NOT NULL REFERENCES knowledge_libraries(id), token_hash TEXT NOT NULL, request_key TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(kb_id,request_key));
      CREATE TABLE knowledge_batches (build_id TEXT NOT NULL REFERENCES knowledge_builds(id), batch_id TEXT NOT NULL, hash TEXT NOT NULL, seq INTEGER NOT NULL, PRIMARY KEY(build_id,batch_id));
      CREATE TABLE knowledge_revisions (kb_id TEXT NOT NULL REFERENCES knowledge_libraries(id), revision INTEGER NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(kb_id,revision));
      CREATE VIRTUAL TABLE knowledge_fts USING fts5(kb_id UNINDEXED, revision UNINDEXED, kind UNINDEXED, target_id UNINDEXED, title UNINDEXED, tokens, tokenize='unicode61');
    `,
  },
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
  {
    id: 2,
    name: 'workbench_versions',
    sql: `
      CREATE TABLE workbench_versions (
        version INTEGER PRIMARY KEY CHECK (version > 0),
        document_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE workbench_state (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      );
    `,
  },
  {
    id: 3,
    name: 'skill_inventory',
    sql: `
      CREATE TABLE skill_inventory (
        id TEXT PRIMARY KEY,
        metadata_json TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1))
      );
      CREATE TABLE skill_state (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
      CREATE TABLE skill_projects (path TEXT PRIMARY KEY);
    `,
  },
  {
    id: 4,
    name: 'tool_tasks_and_upstream_names',
    sql: `
      ALTER TABLE capability_tools ADD COLUMN upstream_name TEXT;
      ALTER TABLE capability_tools ADD COLUMN upstream_signature TEXT;
      CREATE TABLE tool_tasks (id TEXT PRIMARY KEY, capability_id TEXT NOT NULL,
        started_at TEXT NOT NULL, task_json TEXT NOT NULL);
      CREATE INDEX idx_tool_tasks_capability ON tool_tasks(capability_id, started_at DESC);
    `,
  },
  {
    id: 5,
    name: 'tool_archives',
    sql: `ALTER TABLE capabilities ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1));`,
  },
]

export function applyMigrations(database: DatabaseSync): void {
  database.exec('PRAGMA secure_delete = ON;')
  database.exec('PRAGMA foreign_keys = ON;')
  database.exec('PRAGMA journal_mode = WAL;')
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `)

  for (const migration of [...MIGRATIONS].sort((a, b) => a.id - b.id)) {
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
        .prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.id, migration.name, new Date().toISOString())
      database.exec('COMMIT;')
    } catch (error) {
      database.exec('ROLLBACK;')
      throw error
    }
  }

  if (database.prepare('SELECT id FROM knowledge_privacy_cleanup WHERE id=7').get()) {
    // Retry cleanup on the next startup if a checkpoint is blocked or startup is interrupted.
    database.exec('VACUUM;')
    const checkpoint = database.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as { busy: number }
    if (checkpoint.busy) throw new Error('knowledge_privacy_cleanup_busy')
    database.prepare('DELETE FROM knowledge_privacy_cleanup WHERE id=7').run()
    const final = database.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as { busy: number }
    if (final.busy) {
      database.prepare('INSERT OR IGNORE INTO knowledge_privacy_cleanup VALUES (7)').run()
      throw new Error('knowledge_privacy_cleanup_busy')
    }
  }
}
