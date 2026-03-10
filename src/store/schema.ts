import Database from "better-sqlite3";

/** Initialize all tables and indexes for the memory store */
export function initSchema(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS working_memory (
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      access_count INTEGER NOT NULL DEFAULT 0,
      last_accessed_at INTEGER NOT NULL,
      PRIMARY KEY (agent_id, key)
    );

    CREATE INDEX IF NOT EXISTS idx_working_expires ON working_memory(expires_at);
    CREATE INDEX IF NOT EXISTS idx_working_agent ON working_memory(agent_id);

    CREATE TABLE IF NOT EXISTS episodic_memory (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      who TEXT NOT NULL,
      what TEXT NOT NULL,
      context TEXT NOT NULL DEFAULT '',
      outcome TEXT NOT NULL DEFAULT '',
      timestamp INTEGER NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'private',
      access_count INTEGER NOT NULL DEFAULT 0,
      last_accessed_at INTEGER NOT NULL,
      expires_at INTEGER,
      metadata TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_episodic_agent ON episodic_memory(agent_id);
    CREATE INDEX IF NOT EXISTS idx_episodic_timestamp ON episodic_memory(timestamp);
    CREATE INDEX IF NOT EXISTS idx_episodic_visibility ON episodic_memory(visibility);
    CREATE INDEX IF NOT EXISTS idx_episodic_what ON episodic_memory(what);

    CREATE TABLE IF NOT EXISTS semantic_memory (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      fact TEXT NOT NULL,
      topic TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1.0,
      source_episode_ids TEXT NOT NULL DEFAULT '[]',
      visibility TEXT NOT NULL DEFAULT 'private',
      access_count INTEGER NOT NULL DEFAULT 0,
      last_accessed_at INTEGER NOT NULL,
      last_verified_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_semantic_agent ON semantic_memory(agent_id);
    CREATE INDEX IF NOT EXISTS idx_semantic_topic ON semantic_memory(topic);
    CREATE INDEX IF NOT EXISTS idx_semantic_confidence ON semantic_memory(confidence);
    CREATE INDEX IF NOT EXISTS idx_semantic_visibility ON semantic_memory(visibility);

    CREATE TABLE IF NOT EXISTS quarantine (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      tier TEXT NOT NULL,
      data TEXT NOT NULL,
      reason TEXT NOT NULL,
      quarantined_at INTEGER NOT NULL,
      agent_id TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_quarantine_agent ON quarantine(agent_id);

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      memory_id TEXT NOT NULL,
      tier TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      timestamp INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audit_agent ON audit_log(agent_id);
    CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);

    CREATE TABLE IF NOT EXISTS sharing_config (
      agent_id TEXT PRIMARY KEY,
      team_id TEXT,
      default_episodic_visibility TEXT NOT NULL DEFAULT 'private',
      default_semantic_visibility TEXT NOT NULL DEFAULT 'private'
    );
  `);

  // Backward-compatible schema migrations: add embedding columns if they don't exist
  addColumnIfNotExists(db, "episodic_memory", "embedding", "BLOB");
  addColumnIfNotExists(db, "semantic_memory", "embedding", "BLOB");
}

/** Known tables and columns that can be migrated. Inputs are validated against this allowlist. */
const VALID_MIGRATIONS: Record<string, Set<string>> = {
  episodic_memory: new Set(["embedding"]),
  semantic_memory: new Set(["embedding"]),
};

const VALID_TYPES = new Set(["BLOB", "TEXT", "INTEGER", "REAL"]);

/**
 * Add a column to a table if it doesn't already exist.
 * SAFETY: table, column, and type are validated against allowlists to prevent SQL injection.
 */
function addColumnIfNotExists(
  db: Database.Database,
  table: string,
  column: string,
  type: string
): void {
  if (!VALID_MIGRATIONS[table]?.has(column)) {
    throw new Error(`Migration not allowed: ${table}.${column}`);
  }
  if (!VALID_TYPES.has(type)) {
    throw new Error(`Invalid column type: ${type}`);
  }

  const columns = db
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name: string }>;
  const exists = columns.some((c) => c.name === column);
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}
