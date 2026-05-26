import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const dbPath = resolve(process.env.DB_PATH ?? './data/finance.db');
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name          TEXT NOT NULL,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS categories (
    id                 TEXT PRIMARY KEY,
    name_ar            TEXT NOT NULL,
    name_en            TEXT NOT NULL,
    icon               TEXT NOT NULL,
    color              INTEGER NOT NULL,
    type               INTEGER NOT NULL,
    is_default         INTEGER NOT NULL DEFAULT 0,
    user_id            TEXT NOT NULL REFERENCES users(id),
    deleted_at         TEXT,
    updated_at         TEXT NOT NULL,
    server_updated_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_categories_server_updated_at
    ON categories(server_updated_at);

  CREATE TABLE IF NOT EXISTS counterparties (
    id                 TEXT PRIMARY KEY,
    name               TEXT NOT NULL,
    phone              TEXT,
    email              TEXT,
    notes              TEXT,
    -- 0 = supplier, 1 = customer, 2 = both
    type               INTEGER NOT NULL DEFAULT 2,
    user_id            TEXT NOT NULL REFERENCES users(id),
    deleted_at         TEXT,
    updated_at         TEXT NOT NULL,
    server_updated_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_counterparties_server_updated_at
    ON counterparties(server_updated_at);

  CREATE TABLE IF NOT EXISTS invoices (
    id                 TEXT PRIMARY KEY,
    counterparty_id    TEXT NOT NULL REFERENCES counterparties(id),
    -- 0 = issued (AR — customer owes me), 1 = received (AP — I owe supplier)
    direction          INTEGER NOT NULL,
    number             TEXT,
    date               TEXT NOT NULL,
    due_date           TEXT,
    total              REAL NOT NULL,
    currency           TEXT NOT NULL,
    notes              TEXT,
    user_id            TEXT NOT NULL REFERENCES users(id),
    deleted_at         TEXT,
    updated_at         TEXT NOT NULL,
    server_updated_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_invoices_server_updated_at
    ON invoices(server_updated_at);
  CREATE INDEX IF NOT EXISTS idx_invoices_counterparty
    ON invoices(counterparty_id);

  CREATE TABLE IF NOT EXISTS transactions (
    id                 TEXT PRIMARY KEY,
    type               INTEGER NOT NULL,
    amount             REAL NOT NULL,
    currency           TEXT NOT NULL,
    category_id        TEXT NOT NULL REFERENCES categories(id),
    counterparty       TEXT,
    counterparty_id    TEXT REFERENCES counterparties(id),
    invoice_id         TEXT REFERENCES invoices(id),
    date               TEXT NOT NULL,
    payment_method     INTEGER NOT NULL,
    reference_number   TEXT,
    notes              TEXT,
    receipt_path       TEXT,
    user_id            TEXT NOT NULL REFERENCES users(id),
    deleted_at         TEXT,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL,
    server_updated_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_transactions_server_updated_at
    ON transactions(server_updated_at);
`);

// Idempotent column additions for existing DBs (added after initial release).
function addColumnIfMissing(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

addColumnIfMissing('transactions', 'counterparty_id', 'TEXT REFERENCES counterparties(id)');
addColumnIfMissing('transactions', 'invoice_id', 'TEXT REFERENCES invoices(id)');
